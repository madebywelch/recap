package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/madebywelch/recap/engine"
)

func main() {
	var (
		days       = flag.Int("days", 1, "how many days back to scan")
		sinceFlag  = flag.String("since", "", "absolute date YYYY-MM-DD (overrides --days)")
		toolFlag   = flag.String("tool", "all", "session source: claude | codex | pi | both (claude+codex) | all")
		inferFlag  = flag.String("inference", "auto", "inference CLI: claude | codex | pi | auto | /path/to/cli")
		sources    = flag.Bool("sources", false, "print each session source's directory and session counts as JSON, then exit")
		rawFlag    = flag.Bool("raw", false, "skip inference; print scored candidates as JSON")
		minScore   = flag.Int("min-score", 2, "minimum candidate score to keep")
		topN       = flag.Int("top", 30, "max candidates to send to inference (0 = all)")
		archiveDir = flag.String("archive-dir", filepath.Join(os.Getenv("HOME"), ".claude", "morning-recap"), "where to write the dated markdown archive")
		noArchive  = flag.Bool("no-archive", false, "do not write the archive file")
		timeoutSec = flag.Int("timeout", 240, "inference timeout in seconds")
	)
	flag.Parse()

	var since time.Time
	if *sinceFlag != "" {
		t, err := time.ParseInLocation("2006-01-02", *sinceFlag, time.Local)
		if err != nil {
			die("bad --since: %v", err)
		}
		since = t
	}

	opts := engine.Options{
		Days:     *days,
		Since:    since,
		Tool:     *toolFlag,
		MinScore: *minScore,
		Top:      *topN,
	}

	if *sources {
		found, err := engine.DetectSources(opts)
		if err != nil {
			die("%v", err)
		}
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(found)
		return
	}

	res, err := engine.Collect(opts)
	if err != nil {
		die("%v", err)
	}
	tools := res.Tools

	for _, w := range res.Warnings {
		fmt.Fprintf(os.Stderr, "warn: %s scan failed: %v\n", w.Tool, w.Err)
	}

	fmt.Fprintf(os.Stderr, "scanned %d sessions across %s, %d total pairs, %d candidates after scoring\n",
		res.Sessions, strings.Join(tools, "+"), res.Pairs, len(res.Candidates))

	if *rawFlag {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(res)
		return
	}

	// Phase events for the desktop app's progress panel: single-line JSON on
	// stderr, additive to the human lines (docs/engine-json.md).
	emitEvent(scanDoneEvent{
		Event:      "scan_done",
		Sessions:   res.Sessions,
		Pairs:      res.Pairs,
		Candidates: len(res.Candidates),
	})

	if len(res.Candidates) == 0 {
		fmt.Fprintln(os.Stderr, "no candidates — nothing to recap")
		return
	}

	cli, err := detectInferenceCLI(*inferFlag)
	if err != nil {
		die("%v", err)
	}
	fmt.Fprintf(os.Stderr, "inference: %s (timeout %ds)\n", cli, *timeoutSec)

	emitEvent(inferenceStartEvent{
		Event:    "inference_start",
		Cli:      cli,
		TimeoutS: *timeoutSec,
	})

	prompt := buildPrompt(res.Candidates)
	// SIGTERM/SIGINT cancel the run: the desktop app stops a generation by
	// signalling this process, and runInference kills the inference CLI's
	// whole process group on the way out so nothing is orphaned.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	out, err := runInference(ctx, cli, prompt, time.Duration(*timeoutSec)*time.Second)
	if err != nil {
		die("inference: %v", err)
	}

	fmt.Println(out)

	if !*noArchive {
		if err := archive(*archiveDir, res.Since, tools, res.Sessions, res.Pairs, len(res.Candidates), cli, out); err != nil {
			fmt.Fprintf(os.Stderr, "warn: archive failed: %v\n", err)
		}
	}
}

func buildPrompt(candidates []engine.Candidate) string {
	body, _ := json.MarshalIndent(candidates, "", "  ")
	var sb strings.Builder
	sb.WriteString(systemPrompt)
	sb.WriteString("\n\n--- CANDIDATES ---\n")
	sb.Write(body)
	sb.WriteString("\n--- END CANDIDATES ---\n")
	return sb.String()
}

// Phase events the desktop app reads from stderr while it drives generation.
// Single-line JSON so the app can pick them out of the human-readable lines;
// it degrades gracefully when they are absent (an older sidecar).
type scanDoneEvent struct {
	Event      string `json:"event"`
	Sessions   int    `json:"sessions"`
	Pairs      int    `json:"pairs"`
	Candidates int    `json:"candidates"`
}

type inferenceStartEvent struct {
	Event    string `json:"event"`
	Cli      string `json:"cli"`
	TimeoutS int    `json:"timeout_s"`
}

func emitEvent(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	fmt.Fprintln(os.Stderr, string(b))
}

func archive(dir string, since time.Time, tools []string, sessions, pairs, candidates int, cli, body string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	name := fmt.Sprintf("recap-%s.md", time.Now().Format("2006-01-02"))
	path := filepath.Join(dir, name)
	header := fmt.Sprintf("# Recap %s\n\n_window: since %s | tools: %s | sessions: %d | pairs: %d | candidates: %d | inference: %s_\n\n",
		time.Now().Format("2006-01-02 15:04"),
		since.Format("2006-01-02"),
		strings.Join(tools, "+"),
		sessions, pairs, candidates, cli,
	)
	return os.WriteFile(path, []byte(header+body+"\n"), 0o644)
}

func die(format string, a ...any) {
	fmt.Fprintf(os.Stderr, "recap: "+format+"\n", a...)
	os.Exit(1)
}
