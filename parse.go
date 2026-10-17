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

// Pair is one real user message plus the assistant text that answered it.
type Pair struct {
	Tool      string    `json:"tool"`
	Session   string    `json:"session"`
	Cwd       string    `json:"cwd,omitempty"`
	Ts        time.Time `json:"ts"`
	User      string    `json:"user"`
	Assistant string    `json:"assistant_excerpt"`
	Score     int       `json:"score"`
	Signals   []string  `json:"signals,omitempty"`
}

// pairer turns an ordered stream of user and assistant texts into Pairs.
//
// A pair is one real user message plus every assistant text block emitted
// before the next real user message. Both CLIs write one record per content
// block, so a single assistant turn arrives as thinking, text, tool_use and
// tool_result records interleaved. Anything that is not a real user message
// or assistant text is not an event: it neither starts a pair nor ends one.
type pairer struct {
	tool    string
	session string
	cwd     string

	pairs     []Pair
	user      string
	ts        time.Time
	assistant []string
}

func (p *pairer) startUser(text string, ts time.Time) {
	p.flush()
	p.user, p.ts, p.assistant = text, ts, nil
}

func (p *pairer) addAssistant(text string) {
	if p.user == "" || text == "" {
		return
	}
	p.assistant = append(p.assistant, text)
}

func (p *pairer) flush() {
	if p.user != "" && len(p.assistant) > 0 {
		p.pairs = append(p.pairs, Pair{
			Tool:      p.tool,
			Session:   p.session,
			Cwd:       p.cwd,
			Ts:        p.ts,
			User:      redact(p.user),
			Assistant: redact(strings.Join(p.assistant, "\n\n")),
		})
	}
	p.user, p.assistant = "", nil
}

func newScanner(f *os.File) *bufio.Scanner {
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	return sc
}

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

	pr := &pairer{tool: "claude", session: strings.TrimSuffix(filepath.Base(path), ".jsonl")}
	sc := newScanner(f)
	for sc.Scan() {
		var rec claudeRecord
		if err := json.Unmarshal(sc.Bytes(), &rec); err != nil {
			continue
		}
		if pr.cwd == "" && rec.Cwd != "" {
			pr.cwd = rec.Cwd
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
			if text := extractClaudeUserText(msg.Content); text != "" {
				pr.startUser(text, ts)
			}
		case "assistant":
			pr.addAssistant(extractClaudeAssistantText(msg.Content))
		}
	}
	pr.flush()
	return pr.pairs, sc.Err()
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

// injectedPrefixes mark user-role records that the CLI or a harness wrote,
// not the human. Matched after whitespace trimming.
var injectedPrefixes = []string{
	// Claude Code
	"<system_instruction>",
	"<system-reminder>",
	"<command-name>",
	"<local-command-stdout>",
	"<bash-stdout>",
	"<bash-stderr>",
	"<bash-input>",
	"<task-notification>",
	"<user-prompt-submit-hook>",
	"[Request interrupted",
	"This session is being continued from a previous conversation",
	"Caveat: The messages below were generated",
	// Codex
	"<environment_context>",
	"<user_instructions>",
	"<permissions instructions>",
	"<turn_aborted>",
	"<recommended_plugins>",
	"<external_codex_apps_open_page>",
	"<send_user_message_question_reply>",
	"# AGENTS.md instructions",
}

// cleanUserText filters system-injected wrappers; returns "" to drop.
func cleanUserText(s string) string {
	t := strings.TrimSpace(s)
	if len(t) < 3 {
		return ""
	}
	for _, p := range injectedPrefixes {
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

	pr := &pairer{tool: "codex", session: strings.TrimSuffix(filepath.Base(path), ".jsonl")}
	sc := newScanner(f)
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
				pr.cwd = m.Cwd
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
				if cleaned := cleanUserText(text); cleaned != "" {
					pr.startUser(cleaned, ts)
				}
			case "assistant":
				pr.addAssistant(text)
			}
		}
	}
	pr.flush()
	return pr.pairs, sc.Err()
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
