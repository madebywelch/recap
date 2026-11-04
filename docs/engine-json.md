# recap engine JSON — schema v1

This is the machine contract between the recap engine and any consumer: the recap CLI's `--raw` output and the JSON encoding of [`engine.Result`](../engine/engine.go) are the same shape. The desktop app's client types are generated against this schema. A committed example lives in [`testdata/engine-v1.json`](../testdata/engine-v1.json) — byte-identical to `--raw` output for the same candidates, with `scannedAt` pinned — so a UI can develop against the file without running the engine.

The version travels in the payload: `engineVersion`, stamped from `engine.Version` (currently `1.0.0`). Consumers should refuse to render payloads whose major version is newer than the one they understand. Within a major, changes are additive only (new optional fields, new signal names); breaking changes bump the major and ship with a new fixture.

## Top level: the scan envelope

`recap --raw` prints one object:

| field | type | description |
| --- | --- | --- |
| `engineVersion` | string | engine version, e.g. `"1.0.0"`; the major is the handshake |
| `scannedAt` | string | RFC3339 timestamp of the scan |
| `since` | string | start of the scan window, `YYYY-MM-DD` (local midnight of `now - days`, or the `--since` value) |
| `tools` | array of strings | tools scanned, in order: `"claude"`, `"codex"` |
| `sessions` | integer | session files scanned |
| `pairs` | integer | user/assistant pairs parsed before scoring |
| `candidates` | array | scored candidates, best first; `[]` — never `null` — when nothing passed the filters |

Candidates are ordered score descending, then timestamp descending (newest first).

## Candidate

| field | type | always | description |
| --- | --- | --- | --- |
| `id` | string | yes | stable id, see below |
| `tool` | string | yes | `"claude"` or `"codex"` |
| `sessionId` | string | yes | session file stem (filename without `.jsonl`) |
| `cwd` | string | no | working directory recorded in the session, when known |
| `ts` | string | yes | RFC3339 timestamp of the user message |
| `userMessage` | string | yes | redacted user message, excerpted to ≤700 runes |
| `assistantExcerpt` | string | yes | redacted assistant reply, excerpted to ≤1800 runes |
| `score` | integer | yes | `userScore + assistantBonus` |
| `userScore` | integer | yes | user-side signal sum — the gate |
| `assistantBonus` | integer | yes | assistant-side signal sum after the cap; `0` when the gate didn't open, and never above `userScore` when it did |
| `signals` | array of [Signal](#signal) | yes | structured per-signal reasoning, in firing order |
| `signal_strings` | array of strings | no | the same signals rendered `"name:+N"` — the compact form the CLI has always printed; consumers of `signals` can ignore it |

All `userMessage` and `assistantExcerpt` text is redacted before it leaves the parser — API keys, GitHub/Slack/AWS/Google tokens, JWTs, bearer headers, `key: value` forms, private key blocks and long hex blobs are replaced with `[REDACTED]`. A consumer's store only ever sees scrubbed text.

`score == userScore + assistantBonus` always. The user side decides whether a pair is a learning moment at all; the assistant side can at most double one, never create it. When the raw assistant bonus would exceed the user score, the `assistant-cap` signal carries the clamped remainder (a negative weight), landing the bonus at exactly the user score.

## Signal

| field | type | description |
| --- | --- | --- |
| `name` | string | one of the names below |
| `weight` | integer | signed delta as applied — `assistant-cap` carries the clamped remainder |
| `side` | string | `"user"` or `"assistant"`; redundant with the name, but explicit for the UI |

| name | side | weight | fires on |
| --- | --- | --- | --- |
| `reactive` | user | +4 | whole message is a bare reaction: `wait`, `huh?`, `what block?` |
| `wh-question` | user | +3 | sentence opens with what/why/how/explain/tell me about; where/when/which need a `?` |
| `confusion` | user | +3 | "i don't understand", "not sure how", "what do you mean", `wtf` |
| `error-paste` | user | +2 | tracebacks, `error:`, `ECONNREFUSED`, `"type":"error"`, `failed:` |
| `question` | user | +1 | any other sentence ending in `?`, including "how about X" |
| `imperative` | user | −1 | first sentence opens with fix/deploy/merge/build/... |
| `ui-feedback` | user | −1 | contains an `[Image #N]` reference |
| `long` | user | −1 / −2 | over 60 / 150 words |
| `slash-command` | user | −3 | `/agents`, `/skill foo`; paths like `/Users/...` don't match |
| `assistant-depth` | assistant | +1 / +2 | reply is 80 / 200+ words |
| `assistant-code` | assistant | +1 | reply contains code spans |
| `assistant-explains` | assistant | +1 | reply uses "because", "which means", "under the hood", ... |
| `assistant-thin` | assistant | −1 | reply under 15 words |
| `assistant-cap` | assistant | −N | clamps the assistant bonus to the user score |

Assistant-side signals only fire when `userScore > 0`, so a candidate with a non-positive `userScore` has `assistantBonus: 0` and user-side signals only.

## Stable candidate ids

Scanning the same window twice yields identical ids, so consumers can upsert by id instead of duplicating rows: the first 16 hex characters of SHA-256 over `tool|session|ts-unix-nano|dedupKey(user)` — the tool, the session file stem, the user message's Unix-nano timestamp, and the normalized user text used for deduplication (lowercased, marker-stripped, whitespace-collapsed, first 200 runes). Duplicate prompts replayed by forked worktrees or resumed sessions are deduplicated before scoring, so ids are unique within a result.

## stderr phase events (generation runs)

During a generation run (`recap --days N` without `--raw`), the engine additionally emits phase transitions on stderr as single-line JSON, interleaved with the human-readable lines:

```
{"event":"scan_done","sessions":12,"pairs":340,"candidates":58}
{"event":"inference_start","cli":"claude","timeout_s":240}
```

`scan_done` reports the scan counts; `inference_start` fires just before the inference CLI is launched. Treat the events as optional — an older engine emits none, and they never appear on stdout or inside the JSON envelope. `--raw` runs emit no events; the envelope already carries the counts.

## Generation output and source linkage

Generation sends each candidate's `id` with the prompt and requires every explainer entry to end with a machine-readable `sources: id1,id2` line citing the candidate ids the entry drew from. The archive therefore gains one trailing line per entry, harmless to read; parsers must tolerate its absence, since models occasionally drop it. An entry with no sources degrades to a plain title lead.
