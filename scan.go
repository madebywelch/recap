package main

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

// scanClaude returns all session files modified at or after `since`.
func scanClaude(since time.Time) ([]string, error) {
	root := claudeRoot()
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
func scanCodex(since time.Time) ([]string, error) {
	root := codexRoot()
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
