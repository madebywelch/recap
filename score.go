package main

import (
	"regexp"
	"sort"
	"strings"
	"time"
)

type Pair struct {
	Tool      string    `json:"tool"`
	Session   string    `json:"session"`
	Cwd       string    `json:"cwd,omitempty"`
	Ts        time.Time `json:"ts"`
	User      string    `json:"user"`
	Assistant string    `json:"assistant_excerpt"`
	Score     int       `json:"score"`
}

var (
	confusionRe   = regexp.MustCompile(`(?i)\b(what|how|why|wait|huh|hmm|explain|clarify|i don'?t|never heard|not sure|can you|whats|whys|hows|tell me about|what is|what does|what's)\b`)
	shortReactive = map[string]bool{
		"wait": true, "huh?": true, "what?": true, "why?": true, "how?": true,
		"really?": true, "no": true, "stop": true, "actually": true,
	}
)

func score(userText string) int {
	t := strings.ToLower(strings.TrimSpace(userText))
	if shortReactive[t] {
		return 4
	}
	s := 0
	if strings.Contains(userText, "?") {
		s += 2
	}
	if confusionRe.MatchString(userText) {
		s += 2
	}
	if len(strings.Fields(t)) <= 8 {
		s += 1
	}
	for _, p := range []string{"wait", "huh", "what", "why", "how", "explain", "i don"} {
		if strings.HasPrefix(t, p) {
			s += 2
			break
		}
	}
	if strings.HasPrefix(t, "/") {
		s -= 3
	}
	return s
}

func scoreAndFilter(pairs []Pair, minScore int) []Pair {
	out := pairs[:0]
	for _, p := range pairs {
		p.Score = score(p.User)
		if p.Score >= minScore {
			if len(p.User) > 700 {
				p.User = p.User[:700]
			}
			if len(p.Assistant) > 1400 {
				p.Assistant = p.Assistant[:1400]
			}
			out = append(out, p)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Score > out[j].Score })
	return out
}
