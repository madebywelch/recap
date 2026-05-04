package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// --- Claude ---------------------------------------------------------------

type claudeRecord struct {
	Type        string          `json:"type"`
	IsSidechain bool            `json:"isSidechain"`
	IsMeta      bool            `json:"isMeta"`
	UserType    string          `json:"userType"`
	Cwd         string          `json:"cwd"`
	Timestamp   string          `json:"timestamp"`
	SessionID   string          `json:"sessionId"`
	Message     json.RawMessage `json:"message"`
}

type claudeMsg struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

type claudeBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

func parseClaudeFile(path string) ([]Pair, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var pairs []Pair
	var pendingUser string
	var pendingTs time.Time
	var sessionCwd string
	sessionID := strings.TrimSuffix(filepath.Base(path), ".jsonl")

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	for sc.Scan() {
		var rec claudeRecord
		if err := json.Unmarshal(sc.Bytes(), &rec); err != nil {
			continue
		}
		if sessionCwd == "" && rec.Cwd != "" {
			sessionCwd = rec.Cwd
		}
		if rec.IsSidechain || rec.IsMeta {
			continue
		}
		var msg claudeMsg
		if len(rec.Message) > 0 {
			_ = json.Unmarshal(rec.Message, &msg)
		}
		ts, _ := time.Parse(time.RFC3339Nano, rec.Timestamp)

		switch rec.Type {
		case "user":
			if msg.Role != "user" {
				continue
			}
			if rec.UserType != "" && rec.UserType != "external" {
				continue
			}
			text := extractClaudeUserText(msg.Content)
			if text == "" {
				pendingUser = ""
				continue
			}
			pendingUser = text
			pendingTs = ts
		case "assistant":
			if pendingUser == "" {
				continue
			}
			text := extractClaudeAssistantText(msg.Content)
			if text == "" {
				continue
			}
			pairs = append(pairs, Pair{
				Tool:      "claude",
				Session:   sessionID,
				Cwd:       sessionCwd,
				Ts:        pendingTs,
				User:      pendingUser,
				Assistant: text,
			})
			pendingUser = ""
		}
	}
	return pairs, sc.Err()
}

func extractClaudeUserText(content json.RawMessage) string {
	if len(content) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(content, &s); err == nil {
		return cleanUserText(s)
	}
	var blocks []claudeBlock
	if err := json.Unmarshal(content, &blocks); err != nil {
		return ""
	}
	// Tool result lines also have type:"user" — exclude.
	for _, b := range blocks {
		if b.Type == "tool_result" {
			return ""
		}
	}
	var parts []string
	for _, b := range blocks {
		if b.Type == "text" && b.Text != "" {
			parts = append(parts, b.Text)
		}
	}
	return cleanUserText(strings.Join(parts, "\n"))
}

func extractClaudeAssistantText(content json.RawMessage) string {
	if len(content) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(content, &s); err == nil {
		return s
	}
	var blocks []claudeBlock
	if err := json.Unmarshal(content, &blocks); err != nil {
		return ""
	}
	var parts []string
	for _, b := range blocks {
		if b.Type == "text" && b.Text != "" {
			parts = append(parts, b.Text)
		}
	}
	return strings.Join(parts, "\n")
}

// cleanUserText filters obvious system-injected wrappers; returns "" to drop.
func cleanUserText(s string) string {
	t := strings.TrimSpace(s)
	if len(t) < 3 {
		return ""
	}
	prefixes := []string{
		"<system_instruction>",
		"<system-reminder>",
		"<command-name>",
		"<local-command-stdout>",
		"<bash-stdout>",
		"<bash-stderr>",
		"<bash-input>",
		"<task-notification>",
		"<environment_context>",
		"<user-prompt-submit-hook>",
		"This session is being continued from a previous conversation",
		"Caveat: The messages below were generated",
	}
	for _, p := range prefixes {
		if strings.HasPrefix(t, p) {
			return ""
		}
	}
	return s
}

// --- Codex ----------------------------------------------------------------

type codexRecord struct {
	Timestamp string          `json:"timestamp"`
	Type      string          `json:"type"`
	Payload   json.RawMessage `json:"payload"`
}

type codexMessagePayload struct {
	Type    string        `json:"type"`
	Role    string        `json:"role"`
	Content []claudeBlock `json:"content"` // shape happens to match {type, text}
}

type codexSessionMeta struct {
	Cwd string `json:"cwd"`
}

func parseCodexFile(path string) ([]Pair, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var pairs []Pair
	var pendingUser string
	var pendingTs time.Time
	var sessionCwd string
	sessionID := strings.TrimSuffix(filepath.Base(path), ".jsonl")

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	for sc.Scan() {
		var rec codexRecord
		if err := json.Unmarshal(sc.Bytes(), &rec); err != nil {
			continue
		}
		ts, _ := time.Parse(time.RFC3339Nano, rec.Timestamp)
		switch rec.Type {
		case "session_meta":
			var m codexSessionMeta
			if err := json.Unmarshal(rec.Payload, &m); err == nil {
				sessionCwd = m.Cwd
			}
		case "response_item":
			var p codexMessagePayload
			if err := json.Unmarshal(rec.Payload, &p); err != nil {
				continue
			}
			if p.Type != "message" {
				continue
			}
			text := codexBlockText(p.Content)
			switch p.Role {
			case "user":
				cleaned := cleanUserText(text)
				if cleaned == "" {
					pendingUser = ""
					continue
				}
				pendingUser = cleaned
				pendingTs = ts
			case "assistant":
				if pendingUser == "" {
					continue
				}
				if text == "" {
					continue
				}
				pairs = append(pairs, Pair{
					Tool:      "codex",
					Session:   sessionID,
					Cwd:       sessionCwd,
					Ts:        pendingTs,
					User:      pendingUser,
					Assistant: text,
				})
				pendingUser = ""
			}
		}
	}
	return pairs, sc.Err()
}

func codexBlockText(blocks []claudeBlock) string {
	var parts []string
	for _, b := range blocks {
		if b.Text != "" {
			parts = append(parts, b.Text)
		}
	}
	return strings.Join(parts, "\n")
}

// --- shared collector -----------------------------------------------------

func collect(tool string, since time.Time) ([]Pair, int, error) {
	var paths []string
	var err error
	switch tool {
	case "claude":
		paths, err = scanClaude(since)
	case "codex":
		paths, err = scanCodex(since)
	default:
		return nil, 0, fmt.Errorf("unknown tool: %s", tool)
	}
	if err != nil {
		return nil, 0, err
	}
	var all []Pair
	for _, p := range paths {
		var pairs []Pair
		switch tool {
		case "claude":
			pairs, err = parseClaudeFile(p)
		case "codex":
			pairs, err = parseCodexFile(p)
		}
		if err != nil {
			continue
		}
		// File mtime already established recency. Keep all pairs from these
		// sessions — long-running threads that span days are exactly the place
		// learning moments cluster, and the LLM will favor recent/notable items.
		all = append(all, pairs...)
	}
	return all, len(paths), nil
}
