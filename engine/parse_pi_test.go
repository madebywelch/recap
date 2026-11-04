package engine

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const piFixture = "testdata/pi/--Users-dev-src-recap--/2026-11-03T09-12-04-511Z_7c1e4b2a-93d0-4f6e-8a51-2b6f0d9e4c17.jsonl"

// The committed fixture is a synthetic Pi v3 session exercising every entry
// type in Pi's session-format.md: system/model/thinking-level entries, a
// tool call and result inside one assistant turn, a bash execution and a
// custom message (not human turns), an image block, a bare skill
// invocation, a skill invocation with a question, compaction, a branch
// back to an earlier entry, labels, session info, a pasted secret, and an
// aborted reply with no text.
func TestParsePiFixture(t *testing.T) {
	pairs, err := parsePiFile(piFixture)
	if err != nil {
		t.Fatal(err)
	}
	want := []struct {
		user, assistant string
		ts              string
	}{
		{
			"Why does the engine put the inference CLI in its own process group?",
			"Because the CLI spawns children of its own. Setpgid makes the CLI the leader of a new process group, which means a single kill(-pgid) reaches the CLI and everything it started.\nKilling only the CLI's pid would orphan those children, so cancel and timeout both signal the group.",
			"2026-11-03T09:12:31.004Z",
		},
		{
			"what happens to the group if the engine itself gets SIGKILL?",
			"Nothing reaps it: SIGKILL cannot be trapped, so the group outlives the engine. That is why the app sends SIGTERM first and only falls back to SIGKILL after a grace period.",
			"2026-11-03T09:15:20.442Z",
		},
		{
			"how does exec.LookPath decide between two binaries with the same name?",
			"LookPath walks PATH left to right and returns the first executable match, so the earlier directory wins. Under the hood it stats each candidate and checks the execute bit.",
			"2026-11-03T09:20:41Z",
		},
		{
			"my token is [REDACTED] and the call fails with 401, why?",
			"A 401 means the key was rejected; rotate it, because it is now in this transcript.",
			"2026-11-03T09:31:40Z",
		},
	}
	if len(pairs) != len(want) {
		t.Fatalf("want %d pairs, got %d: %+v", len(want), len(pairs), pairs)
	}
	for i, w := range want {
		p := pairs[i]
		if p.User != w.user {
			t.Errorf("pair %d user = %q, want %q", i, p.User, w.user)
		}
		if p.Assistant != w.assistant {
			t.Errorf("pair %d assistant = %q, want %q", i, p.Assistant, w.assistant)
		}
		if ts, _ := time.Parse(time.RFC3339Nano, w.ts); !p.Ts.Equal(ts) {
			t.Errorf("pair %d ts = %v, want %s", i, p.Ts, w.ts)
		}
		if p.Tool != "pi" || p.Cwd != "/Users/dev/src/recap" || p.Session != "2026-11-03T09-12-04-511Z_7c1e4b2a-93d0-4f6e-8a51-2b6f0d9e4c17" {
			t.Errorf("pair %d metadata wrong: tool %q cwd %q session %q", i, p.Tool, p.Cwd, p.Session)
		}
	}
	for _, p := range pairs {
		if strings.Contains(p.User+p.Assistant, "Release notes drafted") {
			t.Errorf("a bare skill invocation's reply leaked into another pair: %+v", p)
		}
		if strings.Contains(p.User, "sk-ant-") {
			t.Errorf("secret survived redaction: %q", p.User)
		}
	}
}

func TestPiUserTextSkillBlocks(t *testing.T) {
	for in, want := range map[string]string{
		`"plain question?"`: "plain question?",
		`[{"type":"text","text":"from blocks"},{"type":"image","data":"x","mimeType":"image/png"}]`:    "from blocks",
		`"<skill name=\"a\" location=\"/s/a/SKILL.md\">\nbody\n</skill>"`:                              "",
		`"<skill name=\"a\" location=\"/s/a/SKILL.md\">\nbody\nmore\n</skill>\n\n  why is it slow?  "`: "why is it slow?",
	} {
		if got := piUserText([]byte(in)); got != want {
			t.Errorf("piUserText(%s) = %q, want %q", in, got, want)
		}
	}
}

func TestPiRootHonorsPiEnvironment(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("PI_CODING_AGENT_DIR", "")
	t.Setenv("PI_CODING_AGENT_SESSION_DIR", "")
	if got, want := piRoot(), filepath.Join(home, ".pi", "agent", "sessions"); got != want {
		t.Errorf("default piRoot = %s, want %s", got, want)
	}
	t.Setenv("PI_CODING_AGENT_DIR", "~/agent")
	if got, want := piRoot(), filepath.Join(home, "agent", "sessions"); got != want {
		t.Errorf("PI_CODING_AGENT_DIR piRoot = %s, want %s", got, want)
	}
	t.Setenv("PI_CODING_AGENT_SESSION_DIR", "/elsewhere/sessions")
	if got := piRoot(); got != "/elsewhere/sessions" {
		t.Errorf("PI_CODING_AGENT_SESSION_DIR piRoot = %s", got)
	}
}

// A Pi tree under ~/.pi/agent/sessions is scanned with the other tools:
// "all" (the default) includes it, "both" keeps its pre-Pi meaning of
// claude+codex, and DetectSources counts every tool's sessions.
func TestCollectAndDetectSourcesIncludePi(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("PI_CODING_AGENT_DIR", "")
	t.Setenv("PI_CODING_AGENT_SESSION_DIR", "")
	data, err := os.ReadFile(piFixture)
	if err != nil {
		t.Fatal(err)
	}
	piDir := filepath.Join(home, ".pi", "agent", "sessions", "--Users-dev-src-recap--")
	writeFile(t, filepath.Join(piDir, filepath.Base(piFixture)), string(data))
	old := filepath.Join(piDir, "2026-01-02T08-00-00-000Z_0b5e.jsonl")
	writeFile(t, old, string(data))
	stale := time.Now().AddDate(0, -2, 0)
	if err := os.Chtimes(old, stale, stale); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(home, ".claude", "projects", "p", "s1.jsonl"),
		`{"type":"user","userType":"external","timestamp":"2026-11-03T09:00:00Z","message":{"role":"user","content":"why is the sky blue?"}}`+"\n"+
			`{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Rayleigh scattering."}]}}`+"\n")

	res, err := Collect(Options{Days: 1, MinScore: -100})
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(res.Tools, ","); got != "claude,codex,pi" {
		t.Errorf("default tools = %s, want claude,codex,pi", got)
	}
	if res.Sessions != 2 || res.Pairs != 5 {
		t.Errorf("want 2 sessions / 5 pairs (the stale Pi file is outside the window), got %d/%d", res.Sessions, res.Pairs)
	}
	piCandidates := 0
	for _, c := range res.Candidates {
		if c.Tool == "pi" {
			piCandidates++
		}
	}
	if piCandidates != 4 {
		t.Errorf("want 4 pi candidates, got %d", piCandidates)
	}

	both, err := Collect(Options{Days: 1, Tool: "both", MinScore: -100})
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(both.Tools, ","); got != "claude,codex" || both.Sessions != 1 {
		t.Errorf("both = %s with %d sessions, want claude,codex with 1", got, both.Sessions)
	}
	if _, err := Collect(Options{Tool: "gemini"}); err == nil {
		t.Error("unknown tool accepted")
	}

	found, err := DetectSources(Options{Days: 1})
	if err != nil {
		t.Fatal(err)
	}
	byTool := map[string]Source{}
	for _, s := range found.Sources {
		byTool[s.Tool] = s
	}
	if s := byTool["pi"]; !s.Found || s.Sessions != 2 || s.RecentSessions != 1 || s.Root != filepath.Join(home, ".pi", "agent", "sessions") {
		t.Errorf("pi source wrong: %+v", s)
	}
	if s := byTool["claude"]; !s.Found || s.Sessions != 1 || s.RecentSessions != 1 {
		t.Errorf("claude source wrong: %+v", s)
	}
	if s := byTool["codex"]; s.Found || s.Sessions != 0 {
		t.Errorf("codex source should be missing: %+v", s)
	}
}
