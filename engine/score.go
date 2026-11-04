package engine

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Scoring finds moments where the user met something unfamiliar. The user
// side decides whether a pair is a learning moment at all; the assistant side
// only amplifies one. An imperative answered with a long explanation is a
// completed task, not a lesson, so assistant signals apply only when the user
// score is already positive.
//
// Every signal is named so `--raw` can show why a pair scored what it did.

const (
	maxUserChars      = 700
	maxAssistantChars = 1800
)

var (
	// Markers the CLIs wrap around user text. Stripped before analysis.
	markerRe = regexp.MustCompile(`</?pasted_content[^>]*>|\[Image #\d+\]`)

	// Discourse fillers that precede the real opener: "ok so how do...".
	fillerRe = regexp.MustCompile(`^(?:(?:ok|okay|so|wait|hmm|hm|also|and|but|yeah|yes|no|nah|hey|hi|alright|well|oh|now|then|right|cool|great|good|look|honestly|actually)\b[\s,.:;!-]*)+`)

	// A sentence with its terminator, so "?" survives the split.
	sentenceRe = regexp.MustCompile(`[^.!?\n]+[.!?]*`)

	// Openers that ask about a concept or mechanism rather than status.
	whRe = regexp.MustCompile(`^(?:what(?:'?s)?|why(?:'?s)?|how(?:'?s)?|explain|clarify|tell me about|walk me through|help me understand|(?:can|could|would|will) you (?:explain|clarify|walk me|tell me|help me understand)|(?:do you know|any idea) (?:what|why|how))\b`)

	// These open subordinate clauses as often as questions ("when you have a
	// moment"), so they only count with a question mark.
	whQuestionOnlyRe = regexp.MustCompile(`^(?:where|when|which)\b.*\?$`)

	// "how about X" proposes; it does not ask how X works.
	aboutRe = regexp.MustCompile(`^(?:how|what) about\b`)

	// Explicit statements of not understanding.
	confusionRe = regexp.MustCompile(`\b(?:i don'?t (?:understand|get it|get that|follow|know (?:what|why|how))|not sure (?:what|why|how|if|whether)|what do(?:es)? (?:you|that|this|it) mean|never heard|unfamiliar|confus(?:ed|ing)|makes no sense|doesn'?t make sense|what'?s the difference|wtf|tf)\b`)

	// Pasted error output: the user hit something and did not know what it meant.
	errorRe = regexp.MustCompile(`(?:traceback \(most recent|\b(?:type|reference|syntax|value|key|attribute|runtime|assertion)error\b|\b(?:panic|fatal|error):|\b(?:econnrefused|enoent|eacces|eaddrinuse|etimedout|econnreset)\b|"type":\s*"error"|\bexit (?:code|status) [1-9]|command not found|no such file|cannot find module|module not found|unhandled (?:exception|rejection)|\bexception\b|\b(?:4\d\d|5\d\d) (?:bad request|unauthorized|forbidden|not found|internal server error|bad gateway|service unavailable|gateway timeout)\b|\bfailed(?::| with\b))`)

	// A slash command, not a path: "/agents", "/skill foo".
	slashRe = regexp.MustCompile(`^/[a-z][\w:-]*(?:\s|$)`)

	// Explanatory connectives in the assistant reply.
	explainRe = regexp.MustCompile(`\b(?:because|which means|this means|that means|under the hood|in other words|the reason|works by|stands for|refers to|by default|rule of thumb|the difference|is a |is the )`)

	reactiveWords = map[string]bool{
		"wait": true, "huh": true, "what": true, "why": true, "how": true,
		"really": true, "tf": true, "wtf": true, "hm": true, "hmm": true,
		"eh": true, "pardon": true,
	}

	imperativeWords = map[string]bool{
		"fix": true, "deploy": true, "push": true, "merge": true, "build": true,
		"implement": true, "add": true, "make": true, "create": true, "update": true,
		"remove": true, "delete": true, "run": true, "go": true, "get": true,
		"commit": true, "rebase": true, "continue": true, "set": true, "put": true,
		"write": true, "change": true, "use": true, "do": true, "proceed": true,
		"finish": true, "ship": true, "install": true, "configure": true, "move": true,
		"rename": true, "refactor": true, "test": true, "check": true, "take": true,
		"just": true, "please": true, "let's": true, "lets": true, "don't": true,
		"dont": true, "stop": true, "revert": true, "rerun": true, "retry": true,
		"try": true, "keep": true, "start": true, "open": true, "close": true,
		"clean": true, "apply": true, "generate": true, "send": true, "give": true,
		"show": true, "reply": true, "resolve": true, "spawn": true, "document": true,
	}
)

// Side names which half of the exchange a signal read: the user message or
// the assistant reply. It is redundant with the signal name, but explicit
// for consumers that render the score arithmetic.
type Side string

const (
	SideUser      Side = "user"
	SideAssistant Side = "assistant"
)

// Signal is one named heuristic that fired on a pair, with the signed weight
// delta it contributed and the side of the exchange it read.
type Signal struct {
	Name   string `json:"name"`
	Weight int    `json:"weight"`
	Side   Side   `json:"side"`
}

// Candidate is a Pair the engine scored as a likely learning moment, with
// the full reasoning behind its score. The JSON shape is the client
// contract in docs/engine-json.md: UserScore is the user-side sum (the
// gate), AssistantBonus the assistant-side sum after the cap, and
// Score == UserScore + AssistantBonus. SignalStrings renders the same
// signals in the compact "name:+N" form the CLI has always printed.
type Candidate struct {
	ID               string    `json:"id"`
	Tool             string    `json:"tool"`
	SessionID        string    `json:"sessionId"`
	Cwd              string    `json:"cwd,omitempty"`
	Ts               time.Time `json:"ts"`
	UserMessage      string    `json:"userMessage"`
	AssistantExcerpt string    `json:"assistantExcerpt"`
	Score            int       `json:"score"`
	UserScore        int       `json:"userScore"`
	AssistantBonus   int       `json:"assistantBonus"`
	Signals          []Signal  `json:"signals"`
	SignalStrings    []string  `json:"signal_strings,omitempty"`
}

// scorePair returns the score and the named signals that produced it.
func scorePair(user, assistant string) (int, []Signal) {
	var sigs []Signal
	add := func(side Side, name string, w int) {
		sigs = append(sigs, Signal{Name: name, Weight: w, Side: side})
	}

	u := strings.ToLower(strings.TrimSpace(markerRe.ReplaceAllString(user, " ")))
	words := strings.Fields(u)

	switch {
	case slashRe.MatchString(u):
		add(SideUser, "slash-command", -3)
	case isReactive(words):
		add(SideUser, "reactive", 4)
	default:
		wh, question, imperative := false, false, false
		for i, s := range sentenceRe.FindAllString(u, -1) {
			s = fillerRe.ReplaceAllString(strings.TrimSpace(s), "")
			if s == "" {
				continue
			}
			switch {
			case aboutRe.MatchString(s):
				question = true
			case whRe.MatchString(s), whQuestionOnlyRe.MatchString(s):
				wh = true
			case strings.HasSuffix(s, "?"):
				question = true
			}
			if i == 0 && !wh && imperativeWords[firstWord(s)] {
				imperative = true
			}
		}
		if wh {
			add(SideUser, "wh-question", 3)
		}
		if question {
			add(SideUser, "question", 1)
		}
		if imperative {
			add(SideUser, "imperative", -1)
		}
		if confusionRe.MatchString(u) {
			add(SideUser, "confusion", 3)
		}
		if errorRe.MatchString(u) {
			add(SideUser, "error-paste", 2)
		}
		if strings.Contains(user, "[Image #") {
			add(SideUser, "ui-feedback", -1)
		}
		switch {
		case len(words) > 150:
			add(SideUser, "long", -2)
		case len(words) > 60:
			add(SideUser, "long", -1)
		}
	}

	userScore := 0
	for _, s := range sigs {
		userScore += s.Weight
	}

	if userScore > 0 {
		a := strings.ToLower(assistant)
		n := len(strings.Fields(a))
		bonus := 0
		switch {
		case n < 15:
			add(SideAssistant, "assistant-thin", -1)
			bonus--
		case n >= 200:
			add(SideAssistant, "assistant-depth", 2)
			bonus += 2
		case n >= 80:
			add(SideAssistant, "assistant-depth", 1)
			bonus++
		}
		if strings.Count(a, "`") >= 2 {
			add(SideAssistant, "assistant-code", 1)
			bonus++
		}
		if len(explainRe.FindAllStringIndex(a, -1)) >= 2 {
			add(SideAssistant, "assistant-explains", 1)
			bonus++
		}
		// The assistant can at most double a learning moment, never create one.
		if bonus > userScore {
			add(SideAssistant, "assistant-cap", userScore-bonus)
		}
	}

	score := 0
	for _, s := range sigs {
		score += s.Weight
	}
	return score, sigs
}

// signalStrings renders a breakdown in the compact "name:+N" form the CLI
// and existing consumers expect.
func signalStrings(sigs []Signal) []string {
	out := make([]string, 0, len(sigs))
	for _, s := range sigs {
		out = append(out, fmt.Sprintf("%s:%+d", s.Name, s.Weight))
	}
	return out
}

// candidateID derives a stable id for a pair: rescanning the same window
// yields the same id, so consumers can upsert by id instead of duplicating
// rows. First 16 hex chars of SHA-256 over
// tool|session|ts-unix-nano|dedupKey(user).
func candidateID(p Pair) string {
	h := fmt.Sprintf("%s|%s|%d|%s", p.Tool, p.Session, p.Ts.UnixNano(), dedupKey(p.User))
	sum := sha256.Sum256([]byte(h))
	return hex.EncodeToString(sum[:])[:16]
}

// newCandidate packages a scored pair for output, splitting the score into
// its user-side and assistant-side sums so consumers can render the
// arithmetic without recomputing it.
func newCandidate(p Pair, score int, sigs []Signal) Candidate {
	if sigs == nil {
		sigs = []Signal{}
	}
	userScore, assistantBonus := 0, 0
	for _, s := range sigs {
		if s.Side == SideUser {
			userScore += s.Weight
		} else {
			assistantBonus += s.Weight
		}
	}
	return Candidate{
		ID:               candidateID(p),
		Tool:             p.Tool,
		SessionID:        p.Session,
		Cwd:              p.Cwd,
		Ts:               p.Ts,
		UserMessage:      p.User,
		AssistantExcerpt: p.Assistant,
		Score:            score,
		UserScore:        userScore,
		AssistantBonus:   assistantBonus,
		Signals:          sigs,
		SignalStrings:    signalStrings(sigs),
	}
}

// isReactive matches a whole message that is a bare reaction: "wait", "huh?",
// "what block?". Three words or fewer, at least one reactive word.
func isReactive(words []string) bool {
	if len(words) == 0 || len(words) > 3 {
		return false
	}
	for _, w := range words {
		if reactiveWords[strings.Trim(w, "?!.,")] {
			return true
		}
	}
	return false
}

func firstWord(s string) string {
	if i := strings.IndexAny(s, " \t,.!?"); i >= 0 {
		return s[:i]
	}
	return s
}

// scoreAndFilter scores every pair, drops those below minScore, collapses
// duplicate user messages (forked worktrees and resumed sessions replay the
// same prompt), truncates for the prompt, and sorts best first. The sort is
// stable with a timestamp tiebreak so `--top` cuts deterministically.
func scoreAndFilter(pairs []Pair, minScore int) []Candidate {
	index := map[string]int{}
	var out []Candidate
	for _, p := range pairs {
		score, sigs := scorePair(p.User, p.Assistant)
		if score < minScore {
			continue
		}
		c := newCandidate(p, score, sigs)
		k := dedupKey(p.User)
		if i, ok := index[k]; ok {
			if c.Score > out[i].Score || (c.Score == out[i].Score && len(c.AssistantExcerpt) > len(out[i].AssistantExcerpt)) {
				out[i] = c
			}
			continue
		}
		index[k] = len(out)
		out = append(out, c)
	}
	for i := range out {
		out[i].UserMessage = truncate(out[i].UserMessage, maxUserChars)
		out[i].AssistantExcerpt = truncate(out[i].AssistantExcerpt, maxAssistantChars)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].Ts.After(out[j].Ts)
	})
	return out
}

func dedupKey(s string) string {
	k := strings.ToLower(markerRe.ReplaceAllString(s, " "))
	k = strings.Join(strings.Fields(k), " ")
	return truncate(k, 200)
}

// truncate keeps the head and tail of s within max runes. Assistant turns
// open with intent and close with the summary; both carry the knowledge.
func truncate(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	const gap = " […] "
	head := max * 2 / 5
	tail := max - head - len([]rune(gap))
	return string(r[:head]) + gap + string(r[len(r)-tail:])
}
