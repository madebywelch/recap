package engine

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Pair is one real user message plus the assistant text that answered it.
// The texts are redacted; scoring them is a separate step (see Score).
type Pair struct {
	Tool      string
	Session   string
	Cwd       string
	Ts        time.Time
	User      string
	Assistant string
}

// pairer turns an ordered stream of user and assistant texts into Pairs.
//
// A pair is one real user message plus every assistant text block emitted
// before the next real user message. Claude Code and Codex write one record
// per content block and Pi one per model call, so a single assistant turn
// arrives as thinking, text, tool call and tool result records interleaved. Anything that is not a real user message
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

// --- Pi -------------------------------------------------------------------

// Pi (github.com/earendil-works/pi, the `pi` coding agent) writes one JSONL
// file per session: a {"type":"session"} header carrying the cwd, then
// entries linked into a tree by id/parentId. Conversation turns are
// {"type":"message"} entries whose message.role is user, assistant,
// toolResult, bashExecution, custom, system, branchSummary or
// compactionSummary; only user and assistant text is a pair. Entries are
// appended in the order they happened, and a branch (/tree) appends its new
// user message after the abandoned branch's turns, so file order pairs each
// user message with the replies that answered it on whichever branch.
// Schema: packages/coding-agent/docs/session-format.md.

type piEntry struct {
	Type      string          `json:"type"`
	Timestamp string          `json:"timestamp"`
	Cwd       string          `json:"cwd"`
	Message   json.RawMessage `json:"message"`
}

type piMessage struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

// piSkillBlock matches Pi's expansion of a /skill:name invocation: the
// skill file wrapped in <skill> tags, then the human's own words, if any,
// after a blank line (parseSkillBlock in core/agent-session.ts).
var piSkillBlock = regexp.MustCompile(`(?s)^<skill name="[^"]*" location="[^"]*">\n.*?\n</skill>(?:\n\n(.+))?$`)

func parsePiFile(path string) ([]Pair, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	pr := &pairer{tool: "pi", session: strings.TrimSuffix(filepath.Base(path), ".jsonl")}
	sc := newScanner(f)
	for sc.Scan() {
		var e piEntry
		if err := json.Unmarshal(sc.Bytes(), &e); err != nil {
			continue
		}
		switch e.Type {
		case "session":
			pr.cwd = e.Cwd
		case "message":
			var msg piMessage
			if err := json.Unmarshal(e.Message, &msg); err != nil {
				continue
			}
			switch msg.Role {
			case "user":
				ts, _ := time.Parse(time.RFC3339Nano, e.Timestamp)
				if text := piUserText(msg.Content); text != "" {
					pr.startUser(text, ts)
				} else {
					pr.flush()
				}
			case "assistant":
				pr.addAssistant(extractClaudeAssistantText(msg.Content))
			}
		}
	}
	pr.flush()
	return pr.pairs, sc.Err()
}

// piUserText is the human's text in a Pi user message: content is a string
// or text/image blocks, the same shapes Claude Code writes, and a skill
// invocation keeps only the words typed after the expanded skill. Pi gives
// injected context its own roles, so every user message is a human turn:
// one with no text left (a bare skill invocation) still ends the previous
// pair instead of donating its reply to it.
func piUserText(content json.RawMessage) string {
	text := extractClaudeUserText(content)
	if m := piSkillBlock.FindStringSubmatch(strings.TrimSpace(text)); m != nil {
		return cleanUserText(strings.TrimSpace(m[1]))
	}
	return text
}

// --- shared collector -----------------------------------------------------

func collectTool(tool string, since time.Time) ([]Pair, int, error) {
	var parse func(string) ([]Pair, error)
	switch tool {
	case "claude":
		parse = parseClaudeFile
	case "codex":
		parse = parseCodexFile
	case "pi":
		parse = parsePiFile
	default:
		return nil, 0, fmt.Errorf("unknown tool: %s", tool)
	}
	paths, err := scanTool(tool, since)
	if err != nil {
		return nil, 0, err
	}
	var all []Pair
	for _, p := range paths {
		pairs, err := parse(p)
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
