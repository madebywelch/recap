package engine

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestCollectScansHomeTranscripts(t *testing.T) {
	home := t.TempDir()
	writeFile(t, filepath.Join(home, ".claude", "projects", "proj-a", "s1.jsonl"), strings.Join([]string{
		`{"type":"user","userType":"external","cwd":"/workspace/app","timestamp":"2026-11-02T09:00:00Z","message":{"role":"user","content":"Why does Cloudflare stop at 15?"}}`,
		`{"type":"assistant","timestamp":"2026-11-02T09:00:30Z","message":{"role":"assistant","content":[{"type":"text","text":"Because each worker is a live isolate."}]}}`,
		`{"type":"user","userType":"external","timestamp":"2026-11-02T09:10:00Z","message":{"role":"user","content":"i get traceback (most recent call last): KeyError 'sk-abcdefghijklmnopqrstuv' why"}}`,
		`{"type":"assistant","timestamp":"2026-11-02T09:10:30Z","message":{"role":"assistant","content":[{"type":"text","text":"The key is missing; use .get() with a default."}]}}`,
	}, "\n")+"\n")
	today := time.Now().Format("2006/01/02")
	writeFile(t, filepath.Join(home, ".codex", "sessions", today, "rollout-1.jsonl"), strings.Join([]string{
		`{"type":"session_meta","payload":{"cwd":"/workspace/firmware"},"timestamp":"2026-11-02T08:00:00Z"}`,
		`{"type":"response_item","timestamp":"2026-11-02T08:05:00Z","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"what is a PDP context?"}]}}`,
		"{\"type\":\"response_item\",\"timestamp\":\"2026-11-02T08:05:30Z\",\"payload\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"A PDP context is a data connection record; this means the carrier assigns an IP. `AT+CGDCONT` sets it, which means the APN names the gateway.\"}]}}",
	}, "\n")+"\n")
	t.Setenv("HOME", home)

	res, err := Collect(Options{Days: 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Warnings) != 0 {
		t.Errorf("unexpected warnings: %v", res.Warnings)
	}
	if res.Sessions != 2 || res.Pairs != 3 {
		t.Errorf("want 2 sessions / 3 pairs, got %d/%d", res.Sessions, res.Pairs)
	}
	if res.ScannedAt.IsZero() {
		t.Error("ScannedAt not set")
	}
	if got, want := fmt.Sprint(res.Tools), "[claude codex pi]"; got != want {
		t.Errorf("Tools = %s, want %s", got, want)
	}
	now := time.Now()
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	if !res.Since.Equal(midnight.AddDate(0, 0, -1)) {
		t.Errorf("Since = %v, want yesterday's local midnight %v", res.Since, midnight.AddDate(0, 0, -1))
	}
	if len(res.Candidates) != 3 {
		t.Fatalf("want 3 candidates, got %d: %+v", len(res.Candidates), res.Candidates)
	}
	top := res.Candidates[0]
	if top.Tool != "codex" || top.Score != 5 || top.SessionID != "rollout-1" {
		t.Errorf("top candidate wrong: %+v", top)
	}
	if top.UserScore != 3 || top.AssistantBonus != 2 {
		t.Errorf("score arithmetic wrong: userScore %d, assistantBonus %d, score %d", top.UserScore, top.AssistantBonus, top.Score)
	}
	if top.Signals[0] != (Signal{Name: "wh-question", Weight: 3, Side: SideUser}) {
		t.Errorf("first signal wrong: %+v", top.Signals[0])
	}
	if len(top.Signals) != len(top.SignalStrings) || top.SignalStrings[0] != "wh-question:+3" {
		t.Errorf("signal strings disagree with signals: %v vs %+v", top.SignalStrings, top.Signals)
	}
	// The pasted key must not survive into any candidate text.
	for _, c := range res.Candidates {
		if strings.Contains(c.UserMessage, "sk-abcdefghijklmnopqrstuv") || strings.Contains(c.AssistantExcerpt, "sk-abcdefghijklmnopqrstuv") {
			t.Errorf("secret survived redaction: %q", c.UserMessage)
		}
	}
	if !strings.Contains(res.Candidates[2].UserMessage, "[REDACTED]") {
		t.Errorf("secret not redacted: %q", res.Candidates[2].UserMessage)
	}
}

func TestCollectIDsStableAcrossRescans(t *testing.T) {
	home := t.TempDir()
	writeFile(t, filepath.Join(home, ".claude", "projects", "proj-a", "s1.jsonl"), strings.Join([]string{
		`{"type":"user","userType":"external","cwd":"/w","timestamp":"2026-11-02T09:00:00Z","message":{"role":"user","content":"Why does Cloudflare stop at 15?"}}`,
		`{"type":"assistant","timestamp":"2026-11-02T09:00:30Z","message":{"role":"assistant","content":[{"type":"text","text":"Because each worker is a live isolate the edge keeps warm."}]}}`,
	}, "\n")+"\n")
	t.Setenv("HOME", home)

	first, err := Collect(Options{Days: 1})
	if err != nil {
		t.Fatal(err)
	}
	second, err := Collect(Options{Days: 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Candidates) == 0 {
		t.Fatal("no candidates to compare")
	}
	for i := range first.Candidates {
		if first.Candidates[i].ID != second.Candidates[i].ID {
			t.Errorf("id not stable across rescans: %q vs %q", first.Candidates[i].ID, second.Candidates[i].ID)
		}
	}
}

func TestCandidateIDSensitiveToPairIdentity(t *testing.T) {
	base := Pair{Tool: "claude", Session: "s1", Ts: time.Date(2026, 10, 16, 9, 0, 0, 0, time.UTC), User: "what is a PDP context?"}
	id := candidateID(base)
	if len(id) != 16 || strings.Trim(id, "0123456789abcdef") != "" {
		t.Errorf("id %q is not 16 hex chars", id)
	}
	if candidateID(base) != id {
		t.Error("id not deterministic")
	}
	for name, p := range map[string]Pair{
		"user text": {Tool: "claude", Session: "s1", Ts: base.Ts, User: "what is an APN?"},
		"session":   {Tool: "claude", Session: "s2", Ts: base.Ts, User: base.User},
		"tool":      {Tool: "codex", Session: "s1", Ts: base.Ts, User: base.User},
		"timestamp": {Tool: "claude", Session: "s1", Ts: base.Ts.Add(time.Hour), User: base.User},
	} {
		if candidateID(p) == id {
			t.Errorf("id ignores %s", name)
		}
	}
	// Normalized duplicates (whitespace, casing, markers) share the dedup key
	// and therefore the id, so the same replayed prompt upserts one row.
	for _, u := range []string{"  what is a PDP context?  ", "What Is A PDP Context?"} {
		if candidateID(Pair{Tool: "claude", Session: "s1", Ts: base.Ts, User: u}) != id {
			t.Errorf("id should ignore normalization differences in %q", u)
		}
	}
}

func TestCollectRejectsUnknownTool(t *testing.T) {
	if _, err := Collect(Options{Tool: "bogus"}); err == nil {
		t.Fatal("want error for unknown tool")
	}
}

func TestScoreMinScoreAndTop(t *testing.T) {
	base := time.Date(2026, 10, 16, 9, 0, 0, 0, time.UTC)
	pairs := []Pair{
		{User: "what is a PDP context?", Ts: base},
		{User: "what is an APN?", Ts: base.Add(time.Hour)},
		{User: "what is a SIM swap?", Ts: base.Add(2 * time.Hour)},
		{User: "deploy it now please", Ts: base.Add(3 * time.Hour)},
	}
	kept := Score(pairs, Options{})
	if len(kept) != 3 {
		t.Fatalf("min-score 0 must drop the imperative, got %d: %+v", len(kept), kept)
	}
	if got := Score(pairs, Options{Top: 2}); len(got) != 2 {
		t.Fatalf("top 2 must cap the list, got %d", len(got))
	} else if got[0].UserMessage != "what is a SIM swap?" || got[1].UserMessage != "what is an APN?" {
		t.Errorf("tiebreak not newest-first: %q then %q", got[0].UserMessage, got[1].UserMessage)
	}
}

func TestResolveSince(t *testing.T) {
	fixed := time.Date(2026, 10, 16, 9, 0, 0, 0, time.UTC)
	if got := resolveSince(Options{Days: 7, Since: fixed}); !got.Equal(fixed) {
		t.Errorf("Since must override Days: %v", got)
	}
	now := time.Now()
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	if got := resolveSince(Options{}); !got.Equal(midnight) {
		t.Errorf("days 0 = today's midnight, got %v", got)
	}
	if got := resolveSince(Options{Days: 1}); !got.Equal(midnight.AddDate(0, 0, -1)) {
		t.Errorf("days 1 = yesterday's midnight, got %v", got)
	}
}

// fixturePairs is the input set behind testdata/engine-v1.json. The fixture
// is the byte-exact `--raw` envelope for these pairs (scannedAt pinned), so
// a UI can develop against the committed file without running the engine —
// and if the JSON shape ever drifts, this test fails first.
func fixturePairs() []Pair {
	return []Pair{
		{
			Tool: "claude", Session: "3f9c2a1e", Cwd: "/workspace/app",
			Ts:   time.Date(2026, 10, 16, 9, 0, 0, 0, time.UTC),
			User: "Why does Cloudflare stop at 15 free workers per account?",
			Assistant: "Cloudflare's free plan caps you at 15 workers because each worker is a live isolate the edge keeps warm. " +
				"The limit is per account, not per zone, which means deleting a worker frees a slot immediately. " +
				"`wrangler whoami` shows the count, and the rule of thumb is one worker per route when you are near the cap.",
		},
		{
			Tool: "claude", Session: "b7d4e0c2",
			Ts:   time.Date(2026, 10, 16, 11, 30, 0, 0, time.UTC),
			User: "i get `traceback (most recent call last): KeyError: 'config'` when i run make, why?",
			Assistant: "The traceback means the dict had no 'config' key; indexing raises KeyError, " +
				"so use `.get('config')` with a default because config is optional in dev.",
		},
		{
			Tool: "codex", Session: "rollout-2026-10-16", Cwd: "/workspace/firmware",
			Ts:        time.Date(2026, 10, 16, 14, 5, 0, 0, time.UTC),
			User:      "wait what?",
			Assistant: "The second branch fires.",
		},
		{
			Tool: "codex", Session: "rollout-2026-10-16", Cwd: "/workspace/firmware",
			Ts:   time.Date(2026, 10, 16, 15, 0, 0, 0, time.UTC),
			User: "Is the rollback automatic after a failed canary?",
			Assistant: "Canary deploys are gated by the rollout controller: it watches the canary's error rate for ten minutes, " +
				"and promotes only when the budget holds. This is automatic for `canaryThreshold: 1` because the controller " +
				"flips the label when the canary exceeds 5% errors, which means a failed canary rolls back without a human. " +
				"The rule of thumb is to keep `canaryThreshold` low and let the controller work.",
		},
		{
			Tool: "codex", Session: "rollout-2026-10-16", Cwd: "/workspace/firmware",
			Ts:        time.Date(2026, 10, 16, 15, 30, 0, 0, time.UTC),
			User:      "deploy it",
			Assistant: "Deployed to production.",
		},
		{
			Tool: "pi", Session: "2026-10-16T13-20-00-000Z_5d2c9e7a-0f41-4c8e-9b3d-6a1e2f7c8b90", Cwd: "/workspace/app",
			Ts:   time.Date(2026, 10, 16, 13, 20, 0, 0, time.UTC),
			User: "how does exec.LookPath pick between two binaries with the same name?",
			Assistant: "LookPath walks PATH left to right and returns the first executable match, so the earlier directory wins. " +
				"Under the hood it stats each candidate and checks the execute bit, which means a stale binary earlier on PATH shadows a newer one.",
		},
	}
}

// fixtureResult is the envelope committed as testdata/engine-v1.json: the
// same candidate set the app's scan recipe (`--min-score -100 --top 0`)
// would keep, with scannedAt and since pinned so the bytes are stable.
func fixtureResult() Result {
	return Result{
		ScannedAt:  time.Date(2026, 10, 16, 16, 0, 0, 0, time.UTC),
		Since:      time.Date(2026, 10, 15, 0, 0, 0, 0, time.UTC),
		Tools:      []string{"claude", "codex", "pi"},
		Sessions:   4,
		Pairs:      6,
		Candidates: Score(fixturePairs(), Options{MinScore: -100}),
	}
}

func TestScanResultJSONMatchesFixture(t *testing.T) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetIndent("", "  ")
	if err := enc.Encode(fixtureResult()); err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile("../testdata/engine-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	if buf.String() != string(want) {
		t.Errorf("engine JSON drifted from testdata/engine-v1.json\n--- got ---\n%s--- want ---\n%s", buf.String(), want)
	}

	// Schema invariants the fixture must demonstrate.
	res := fixtureResult()
	if len(res.Candidates) != 6 {
		t.Fatalf("want 6 candidates (min-score -100 keeps the demoted pair), got %d", len(res.Candidates))
	}
	for _, c := range res.Candidates {
		if c.Score != c.UserScore+c.AssistantBonus {
			t.Errorf("%q: score %d != userScore %d + assistantBonus %d", c.UserMessage, c.Score, c.UserScore, c.AssistantBonus)
		}
		if c.UserScore > 0 && c.AssistantBonus > c.UserScore {
			t.Errorf("%q: assistantBonus %d exceeds userScore %d — cap missing", c.UserMessage, c.AssistantBonus, c.UserScore)
		}
		if c.UserScore <= 0 {
			for _, s := range c.Signals {
				if s.Side == SideAssistant {
					t.Errorf("%q: assistant signal fired with userScore %d", c.UserMessage, c.UserScore)
				}
			}
		}
		for i, s := range c.Signals {
			if c.SignalStrings[i] != fmt.Sprintf("%s:%+d", s.Name, s.Weight) {
				t.Errorf("%q: signal_strings[%d] = %q, disagrees with signals %+v", c.UserMessage, i, c.SignalStrings[i], s)
			}
		}
		if len(c.ID) != 16 || strings.Trim(c.ID, "0123456789abcdef") != "" {
			t.Errorf("%q: bad id %q", c.UserMessage, c.ID)
		}
	}
}
