package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFixture(t *testing.T, name string, lines ...string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(p, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestParseClaudeAggregatesTurn(t *testing.T) {
	p := writeFixture(t, "abc.jsonl",
		`{"type":"user","userType":"external","cwd":"/w","timestamp":"2026-10-16T09:00:00Z","message":{"role":"user","content":[{"type":"text","text":"Why does Cloudflare stop at 15?"}]}}`,
		`{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"..."}]}}`,
		`{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{}}]}}`,
		`{"type":"user","userType":"external","message":{"role":"user","content":[{"type":"tool_result","content":"ok"}]}}`,
		`{"type":"user","userType":"external","message":{"role":"user","content":"<task-notification>done</task-notification>"}}`,
		`{"type":"user","isMeta":true,"message":{"role":"user","content":"<system-reminder>x</system-reminder>"}}`,
		`{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"It is a fixed limit."}]}}`,
		`{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Keep the design."}]}}`,
		`{"type":"user","userType":"external","timestamp":"2026-10-16T09:10:00Z","message":{"role":"user","content":"ok deploy"}}`,
		`{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Done."}]}}`,
		`{"type":"user","userType":"external","message":{"role":"user","content":"[Request interrupted by user]"}}`,
		`{"type":"user","userType":"external","message":{"role":"user","content":"status?"}}`,
	)
	pairs, err := parseClaudeFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if len(pairs) != 2 {
		t.Fatalf("want 2 pairs, got %d: %+v", len(pairs), pairs)
	}
	first := pairs[0]
	if first.Assistant != "It is a fixed limit.\n\nKeep the design." {
		t.Errorf("assistant turn not aggregated: %q", first.Assistant)
	}
	if first.Cwd != "/w" || first.Session != "abc" || first.Ts.Hour() != 9 {
		t.Errorf("metadata wrong: %+v", first)
	}
	if pairs[1].User != "ok deploy" || pairs[1].Assistant != "Done." {
		t.Errorf("second pair wrong: %+v", pairs[1])
	}
}

func TestParseCodexAggregatesTurn(t *testing.T) {
	p := writeFixture(t, "rollout-x.jsonl",
		`{"type":"session_meta","payload":{"cwd":"/c"}}`,
		`{"type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"# AGENTS.md instructions"}]}}`,
		`{"type":"response_item","timestamp":"2026-10-16T09:00:00Z","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"what is a PDP context?"}]}}`,
		`{"type":"response_item","payload":{"type":"function_call","name":"shell"}}`,
		`{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"A PDP context binds the modem to an APN."}]}}`,
		`{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Activate it with AT+CGACT."}]}}`,
		`{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<send_user_message_question_reply>[]"}]}}`,
		`{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Reply with the word ok."}]}}`,
	)
	pairs, err := parseCodexFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if len(pairs) != 1 {
		t.Fatalf("want 1 pair, got %d: %+v", len(pairs), pairs)
	}
	if pairs[0].Assistant != "A PDP context binds the modem to an APN.\n\nActivate it with AT+CGACT." {
		t.Errorf("assistant turn not aggregated: %q", pairs[0].Assistant)
	}
	if pairs[0].Cwd != "/c" || pairs[0].Tool != "codex" {
		t.Errorf("metadata wrong: %+v", pairs[0])
	}
}

func TestCleanUserTextDropsInjected(t *testing.T) {
	for _, s := range []string{
		"  <system-reminder>x</system-reminder>",
		"<command-name>/goal</command-name>",
		"[Request interrupted by user for tool use]",
		"This session is being continued from a previous conversation.",
		"<recommended_plugins>...",
		"ok",
	} {
		if cleanUserText(s) != "" {
			t.Errorf("should drop %q", s)
		}
	}
	if cleanUserText("\n\n<pasted_content id=\"x\">\nreal text\n</pasted_content>") == "" {
		t.Error("pasted content is user text and must survive")
	}
}
