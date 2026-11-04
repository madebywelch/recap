package engine

import (
	"strings"
	"testing"
)

func TestRedact(t *testing.T) {
	in := "key=sk-abcdefghijklmnopqrstuv and ghp_abcdefghijklmnopqrstuvwxyz too"
	out := redact(in)
	if strings.Contains(out, "sk-abcdefghijklmnopqrstuv") || strings.Contains(out, "ghp_abcdefghijklmnopqrstuvwxyz") {
		t.Errorf("secrets survived redaction: %q", out)
	}
	if got := strings.Count(out, "[REDACTED]"); got != 2 {
		t.Errorf("want 2 redactions, got %d in %q", got, out)
	}
	// Prose like "the key: keep it simple" has no 16+ char token after the
	// colon and must pass through untouched.
	prose := redact("the key: keep it simple")
	if prose != "the key: keep it simple" {
		t.Errorf("prose mangled: %q", prose)
	}
}
