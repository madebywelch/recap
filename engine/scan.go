package engine

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func claudeRoot() string {
	return filepath.Join(os.Getenv("HOME"), ".claude", "projects")
}

func codexRoot() string {
	return filepath.Join(os.Getenv("HOME"), ".codex", "sessions")
}

// piRoot resolves Pi's session directory the way Pi itself does
// (packages/coding-agent/src/config.ts): PI_CODING_AGENT_SESSION_DIR wins,
// then PI_CODING_AGENT_DIR/sessions, then ~/.pi/agent/sessions.
func piRoot() string {
	if dir := os.Getenv("PI_CODING_AGENT_SESSION_DIR"); dir != "" {
		return expandHome(dir)
	}
	if dir := os.Getenv("PI_CODING_AGENT_DIR"); dir != "" {
		return filepath.Join(expandHome(dir), "sessions")
	}
	return filepath.Join(os.Getenv("HOME"), ".pi", "agent", "sessions")
}

func expandHome(p string) string {
	if p == "~" || strings.HasPrefix(p, "~/") {
		return filepath.Join(os.Getenv("HOME"), p[1:])
	}
	return p
}

func toolRoot(tool string) (string, error) {
	switch tool {
	case "claude":
		return claudeRoot(), nil
	case "codex":
		return codexRoot(), nil
	case "pi":
		return piRoot(), nil
	default:
		return "", fmt.Errorf("unknown tool: %s", tool)
	}
}

// scanTool returns the tool's session files modified at or after `since`.
func scanTool(tool string, since time.Time) ([]string, error) {
	root, err := toolRoot(tool)
	if err != nil {
		return nil, err
	}
	if tool == "codex" {
		return scanCodex(root, since)
	}
	return walkSessions(root, since)
}

// walkSessions returns every .jsonl file under root modified at or after
// `since`. Claude Code nests sessions one directory per project and Pi one
// directory per working directory; both trees are walked whole.
func walkSessions(root string, since time.Time) ([]string, error) {
	if _, err := os.Stat(root); os.IsNotExist(err) {
		return nil, nil
	}
	var out []string
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() || !strings.HasSuffix(path, ".jsonl") {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		if info.ModTime().Before(since) {
			return nil
		}
		out = append(out, path)
		return nil
	})
	return out, err
}

// scanCodex walks the date-partitioned tree for `since`..now and returns files
// modified at or after `since`. Faster than walking the entire tree.
func scanCodex(root string, since time.Time) ([]string, error) {
	if _, err := os.Stat(root); os.IsNotExist(err) {
		return nil, nil
	}
	var out []string
	day := time.Date(since.Year(), since.Month(), since.Day(), 0, 0, 0, 0, since.Location())
	end := time.Now().AddDate(0, 0, 1)
	for d := day; d.Before(end); d = d.AddDate(0, 0, 1) {
		dir := filepath.Join(root, fmt.Sprintf("%04d/%02d/%02d", d.Year(), d.Month(), d.Day()))
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".jsonl") {
				continue
			}
			info, err := e.Info()
			if err != nil {
				continue
			}
			if info.ModTime().Before(since) {
				continue
			}
			out = append(out, filepath.Join(dir, e.Name()))
		}
	}
	return out, nil
}
