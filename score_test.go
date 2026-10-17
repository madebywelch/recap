package main

import (
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

// explanatory is a ~250-word answer with code spans and explanatory
// connectives: the shape of a reply that actually teaches something.
var explanatory = strings.Repeat("The alarm runs because `Durable Objects` cap background work; this means the limit is a platform rule, not ours. ", 14)

func hasSignal(sigs []string, name string) bool {
	for _, s := range sigs {
		if strings.HasPrefix(s, name+":") {
			return true
		}
	}
	return false
}

func TestScorePairSignals(t *testing.T) {
	longSpec := strings.Repeat("build the widget so it opens on hover and stays open while dragging. ", 25) + "what would you suggest for state?"
	cases := []struct {
		name      string
		user      string
		assistant string
		want      []string
		absent    []string
		min, max  int
	}{
		{"concept question", "Why does Cloudflare stop at 15?", explanatory,
			[]string{"wh-question", "assistant-depth", "assistant-code", "assistant-explains"}, nil, 6, 6},
		{"status question, thin answer", "Is the Cloudflare teardown complete?", "Yes, all gone.",
			[]string{"question", "assistant-thin"}, []string{"wh-question"}, 0, 0},
		{"imperative never amplified", "fix ci failures", explanatory,
			[]string{"imperative"}, []string{"assistant-depth", "assistant-code"}, -1, -1},
		{"reactive", "wait what?", explanatory, []string{"reactive"}, []string{"wh-question"}, 8, 8},
		{"reactive bare, thin reply", "huh", "Sorry, I meant the second branch.", []string{"reactive", "assistant-thin"}, nil, 3, 3},
		{"confusion", "I don't understand what thresholds for jev mean.", explanatory, []string{"confusion"}, nil, 6, 6},
		{"error paste json", "hi\n400 {\"type\":\"error\",\"error\":{\"message\":\"credit balance too low\"}}", explanatory,
			[]string{"error-paste"}, nil, 4, 4},
		{"error paste failed colon", "i install the extension and get WebSocket connection failed: HTTP Authentication failed", explanatory,
			[]string{"error-paste"}, nil, 4, 4},
		{"not an error paste", "fix ci failures", explanatory, nil, []string{"error-paste"}, -1, -1},
		{"slash command", "/agents", explanatory, []string{"slash-command"}, nil, -3, -3},
		{"path is not a slash command", "/Users/robert/Downloads/kit.zip", explanatory, nil, []string{"slash-command"}, 0, 0},
		{"when clause is not a question", "When you have a moment, a couple of small asks.", explanatory, nil, []string{"wh-question"}, 0, 0},
		{"where with question mark", "Where does the config live?", explanatory, []string{"wh-question"}, nil, 6, 6},
		{"how about proposes", "how about power cord", explanatory, []string{"question"}, []string{"wh-question"}, 2, 2},
		{"fillers stripped", "okay so how do we fix this?", explanatory, []string{"wh-question"}, []string{"imperative"}, 6, 6},
		{"long imperative spec with incidental question", longSpec, explanatory, []string{"wh-question", "long", "imperative"}, []string{"assistant-depth"}, 0, 1},
		{"ui feedback", "[Image #3] what is this spinner?", explanatory, []string{"ui-feedback", "wh-question"}, nil, 4, 4},
		{"pasted content markers stripped", "\n\n<pasted_content id=\"ab12\">\nwhat is a PDP context?\n</pasted_content>", explanatory,
			[]string{"wh-question"}, nil, 6, 6},
		{"assistant bonus capped at user score", "did i break something?", explanatory,
			[]string{"question", "assistant-cap"}, nil, 2, 2},
		{"empty", "", explanatory, nil, nil, 0, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			score, sigs := scorePair(c.user, c.assistant)
			for _, w := range c.want {
				if !hasSignal(sigs, w) {
					t.Errorf("missing signal %q in %v", w, sigs)
				}
			}
			for _, a := range c.absent {
				if hasSignal(sigs, a) {
					t.Errorf("unexpected signal %q in %v", a, sigs)
				}
			}
			if score < c.min || score > c.max {
				t.Errorf("score %d outside [%d,%d]; signals %v", score, c.min, c.max, sigs)
			}
		})
	}
}

func TestScoreOrdering(t *testing.T) {
	concept, _ := scorePair("How does the browser navigation work exactly?", explanatory)
	status, _ := scorePair("Are we ready for me to test locally?", explanatory)
	order, _ := scorePair("Get it deployed.", explanatory)
	if !(concept > status && status > order) {
		t.Fatalf("want concept > status > imperative, got %d %d %d", concept, status, order)
	}
}

func TestScoreAndFilter(t *testing.T) {
	t0 := time.Date(2026, 10, 10, 9, 0, 0, 0, time.UTC)
	pairs := []Pair{
		{User: "Why does Cloudflare stop at 15?", Assistant: "Short.", Ts: t0},
		{User: "why does cloudflare stop at 15?", Assistant: explanatory, Ts: t0.Add(time.Hour)},
		{User: "deploy it", Assistant: explanatory, Ts: t0.Add(2 * time.Hour)},
		{User: "What is the gateway for?", Assistant: explanatory, Ts: t0.Add(3 * time.Hour)},
		{User: "What is PDP?", Assistant: explanatory, Ts: t0.Add(4 * time.Hour)},
	}
	out := scoreAndFilter(pairs, 2)
	if len(out) != 3 {
		t.Fatalf("want 3 candidates (dedup + min score), got %d: %+v", len(out), out)
	}
	for _, p := range out {
		if p.Assistant == "Short." {
			t.Errorf("dedup kept the weaker duplicate")
		}
		if len(p.Signals) == 0 {
			t.Errorf("signals missing on %q", p.User)
		}
	}
	// Equal scores order newest first, deterministically.
	if out[0].Ts.Before(out[1].Ts) || out[1].Ts.Before(out[2].Ts) {
		t.Errorf("tiebreak not newest-first: %v %v %v", out[0].Ts, out[1].Ts, out[2].Ts)
	}
}

func TestTruncateRuneSafe(t *testing.T) {
	s := strings.Repeat("é", 2000)
	got := truncate(s, 700)
	if !utf8.ValidString(got) {
		t.Fatal("truncate split a rune")
	}
	if n := utf8.RuneCountInString(got); n != 700 {
		t.Fatalf("want 700 runes, got %d", n)
	}
	if !strings.Contains(got, "[…]") {
		t.Fatal("gap marker missing")
	}
	if truncate("short", 700) != "short" {
		t.Fatal("short strings must pass through")
	}
}
