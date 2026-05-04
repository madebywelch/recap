package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func main() {
	var (
		days       = flag.Int("days", 1, "how many days back to scan")
		sinceFlag  = flag.String("since", "", "absolute date YYYY-MM-DD (overrides --days)")
		toolFlag   = flag.String("tool", "both", "session source: claude | codex | both")
		inferFlag  = flag.String("inference", "auto", "inference CLI: claude | codex | auto")
		rawFlag    = flag.Bool("raw", false, "skip inference; print scored candidates as JSON")
		minScore   = flag.Int("min-score", 2, "minimum candidate score to keep")
		topN       = flag.Int("top", 30, "max candidates to send to inference (0 = all)")
		archiveDir = flag.String("archive-dir", filepath.Join(os.Getenv("HOME"), ".claude", "morning-recap"), "where to write the dated markdown archive")
		noArchive  = flag.Bool("no-archive", false, "do not write the archive file")
		timeoutSec = flag.Int("timeout", 240, "inference timeout in seconds")
	)
	flag.Parse()

	since, err := resolveSince(*sinceFlag, *days)
	if err != nil {
		die("bad --since: %v", err)
	}

	tools := []string{}
	switch *toolFlag {
	case "both":
		tools = []string{"claude", "codex"}
	case "claude", "codex":
		tools = []string{*toolFlag}
	default:
		die("--tool must be claude | codex | both")
	}

	var allPairs []Pair
	totalSessions := 0
	for _, t := range tools {
		pairs, n, err := collect(t, since)
		if err != nil {
			fmt.Fprintf(os.Stderr, "warn: %s scan failed: %v\n", t, err)
			continue
		}
		totalSessions += n
		allPairs = append(allPairs, pairs...)
	}

	totalPairs := len(allPairs)
	candidates := scoreAndFilter(allPairs, *minScore)
	if *topN > 0 && len(candidates) > *topN {
		candidates = candidates[:*topN]
	}

	fmt.Fprintf(os.Stderr, "scanned %d sessions across %s, %d total pairs, %d candidates after scoring\n",
		totalSessions, strings.Join(tools, "+"), totalPairs, len(candidates))

	if *rawFlag {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(candidates)
		return
	}

	if len(candidates) == 0 {
		fmt.Fprintln(os.Stderr, "no candidates — nothing to recap")
		return
	}

	cli, err := detectInferenceCLI(*inferFlag)
	if err != nil {
		die("%v", err)
	}
	fmt.Fprintf(os.Stderr, "inference: %s (timeout %ds)\n", cli, *timeoutSec)

	prompt := buildPrompt(candidates)
	out, err := runInference(cli, prompt, time.Duration(*timeoutSec)*time.Second)
	if err != nil {
		die("inference: %v", err)
	}

	fmt.Println(out)

	if !*noArchive {
		if err := archive(*archiveDir, since, tools, totalSessions, totalPairs, len(candidates), cli, out); err != nil {
			fmt.Fprintf(os.Stderr, "warn: archive failed: %v\n", err)
		}
	}
}

func resolveSince(sinceArg string, days int) (time.Time, error) {
	if sinceArg != "" {
		t, err := time.ParseInLocation("2006-01-02", sinceArg, time.Local)
		return t, err
	}
	now := time.Now()
	d := now.AddDate(0, 0, -days)
	return time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, now.Location()), nil
}

func buildPrompt(candidates []Pair) string {
	body, _ := json.MarshalIndent(candidates, "", "  ")
	var sb strings.Builder
	sb.WriteString(systemPrompt)
	sb.WriteString("\n\n--- CANDIDATES ---\n")
	sb.Write(body)
	sb.WriteString("\n--- END CANDIDATES ---\n")
	return sb.String()
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
