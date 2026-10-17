package main

import "regexp"

// Candidates are piped to a hosted model and written to a plaintext archive.
// Users paste API keys into agent sessions constantly, so every text that
// leaves the parser passes through redact first.
type secretPattern struct {
	re   *regexp.Regexp
	repl string
}

var secretPatterns = []secretPattern{
	{regexp.MustCompile(`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----`), "[REDACTED]"},
	// Stripe, OpenAI, Anthropic, Kernel and similar sk_/pk_/rk_ prefixed keys.
	{regexp.MustCompile(`\b(?:sk|pk|rk)[_-][A-Za-z0-9._\-]{16,}`), "[REDACTED]"},
	{regexp.MustCompile(`\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}`), "[REDACTED]"},
	{regexp.MustCompile(`\bgithub_pat_[A-Za-z0-9_]{20,}`), "[REDACTED]"},
	{regexp.MustCompile(`\bxox[abprs]-[A-Za-z0-9\-]{10,}`), "[REDACTED]"},
	{regexp.MustCompile(`\bAKIA[0-9A-Z]{16}\b`), "[REDACTED]"},
	{regexp.MustCompile(`\bAIza[0-9A-Za-z\-_]{35}`), "[REDACTED]"},
	// JWT: three base64url segments.
	{regexp.MustCompile(`\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}`), "[REDACTED]"},
	{regexp.MustCompile(`(?i)\b(bearer\s+)[A-Za-z0-9._\-]{16,}`), "${1}[REDACTED]"},
	// "exa key: <value>", "token=<value>", "secret: <value>". The value must
	// be one unbroken 16+ char token, so prose like "the key: keep it simple"
	// is untouched.
	{regexp.MustCompile(`(?i)\b((?:api[_\- ]?key|key|secret|token|password|passwd|credentials?)\b\s*[:=]\s*["']?)[A-Za-z0-9._\-]{16,}`), "${1}[REDACTED]"},
	// Long hex blobs. 40 hex is a git SHA and stays.
	{regexp.MustCompile(`\b[0-9a-f]{48,}\b`), "[REDACTED]"},
}

func redact(s string) string {
	for _, p := range secretPatterns {
		s = p.re.ReplaceAllString(s, p.repl)
	}
	return s
}
