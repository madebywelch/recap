// Package engine implements recap's transcript pipeline: scan local Claude
// Code and Codex session files, pair each real user message with the
// assistant turn that answered it, redact secrets, and score each pair for
// "learning moment" likelihood.
//
// The recap CLI is a thin presentation layer over this package; desktop and
// other consumers can run the same pipeline programmatically. Collect
// returns a Result whose JSON encoding is the versioned client contract
// documented in docs/engine-json.md, with a committed example fixture in
// testdata/.
package engine

import (
	"encoding/json"
	"fmt"
	"time"
)

// Version is the engine version reported in every JSON response
// (Result.EngineVersion). The desktop app uses the major component as a
// handshake and refuses to render payloads from a newer major than it
// understands. Schema changes within a major are additive; breaking
// changes bump the major. Overridable at build time with
// -ldflags "-X github.com/madebywelch/recap/engine.Version=…".
var Version = "1.0.0"

// Options mirrors the recap CLI flags. The zero value scans from midnight
// local today, reads both tools, keeps every pair that scored non-negative,
// and returns all candidates.
type Options struct {
	// Days is how many days back to scan; the window starts at local
	// midnight. Ignored when Since is set.
	Days int
	// Since is the absolute scan cutoff (files modified at or after it).
	// Overrides Days when non-zero.
	Since time.Time
	// Tool selects the session source: "claude", "codex" or "both".
	Tool string
	// MinScore is the minimum candidate score to keep.
	MinScore int
	// Top caps the number of candidates returned; 0 keeps all.
	Top int
}

// Result is a completed Collect run. Its JSON encoding is the scan
// envelope of docs/engine-json.md: engineVersion is stamped from Version by
// MarshalJSON so it can never be missing, since is rendered as YYYY-MM-DD,
// and warnings stay Go-side (they are reported on stderr, not in JSON).
type Result struct {
	ScannedAt  time.Time
	Since      time.Time
	Tools      []string
	Sessions   int
	Pairs      int
	Candidates []Candidate
	Warnings   []Warning
}

// MarshalJSON emits the documented envelope: engineVersion, scannedAt,
// since (YYYY-MM-DD), tools, sessions, pairs, candidates. Empty lists are
// rendered as [] rather than null.
func (r Result) MarshalJSON() ([]byte, error) {
	candidates := r.Candidates
	if candidates == nil {
		candidates = []Candidate{}
	}
	tools := r.Tools
	if tools == nil {
		tools = []string{}
	}
	return json.Marshal(struct {
		EngineVersion string      `json:"engineVersion"`
		ScannedAt     time.Time   `json:"scannedAt"`
		Since         string      `json:"since"`
		Tools         []string    `json:"tools"`
		Sessions      int         `json:"sessions"`
		Pairs         int         `json:"pairs"`
		Candidates    []Candidate `json:"candidates"`
	}{
		EngineVersion: Version,
		ScannedAt:     r.ScannedAt,
		Since:         r.Since.Format("2006-01-02"),
		Tools:         tools,
		Sessions:      r.Sessions,
		Pairs:         r.Pairs,
		Candidates:    candidates,
	})
}

// Warning reports one tool's scan failing without aborting the whole run.
type Warning struct {
	Tool string
	Err  error
}

// Collect runs the whole pipeline — scan, parse, redact, score — and returns
// the candidates worth recapping. A tool whose scan fails is skipped with a
// Warning rather than failing the run.
func Collect(opts Options) (Result, error) {
	tools, err := expandTools(opts.Tool)
	if err != nil {
		return Result{}, err
	}
	since := resolveSince(opts)

	var pairs []Pair
	var warnings []Warning
	sessions := 0
	for _, t := range tools {
		p, n, err := collectTool(t, since)
		if err != nil {
			warnings = append(warnings, Warning{Tool: t, Err: err})
			continue
		}
		sessions += n
		pairs = append(pairs, p...)
	}
	return Result{
		ScannedAt:  time.Now(),
		Since:      since,
		Tools:      tools,
		Sessions:   sessions,
		Pairs:      len(pairs),
		Candidates: Score(pairs, opts),
		Warnings:   warnings,
	}, nil
}

// Score scores parsed pairs and returns the candidates that clear
// opts.MinScore, deduplicated by user text, excerpted for display, sorted
// best first, and capped at opts.Top when Top > 0.
func Score(pairs []Pair, opts Options) []Candidate {
	candidates := scoreAndFilter(pairs, opts.MinScore)
	if opts.Top > 0 && len(candidates) > opts.Top {
		candidates = candidates[:opts.Top]
	}
	return candidates
}

func resolveSince(opts Options) time.Time {
	if !opts.Since.IsZero() {
		return opts.Since
	}
	now := time.Now()
	d := now.AddDate(0, 0, -opts.Days)
	return time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, now.Location())
}

func expandTools(tool string) ([]string, error) {
	switch tool {
	case "", "both":
		return []string{"claude", "codex"}, nil
	case "claude", "codex":
		return []string{tool}, nil
	default:
		return nil, fmt.Errorf("unknown tool: %s", tool)
	}
}
