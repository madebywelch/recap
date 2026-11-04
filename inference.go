package main

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// inferenceCLIs are the CLIs "auto" tries, in order.
var inferenceCLIs = []string{"claude", "codex", "pi"}

// detectInferenceCLI returns the first of inferenceCLIs on PATH, honoring
// an explicit preference if set. A preference containing a path separator
// is treated as a custom executable (Go's exec.LookPath accepts absolute
// or relative paths directly), so the desktop Settings can pass a custom
// CLI path straight through.
func detectInferenceCLI(prefer string) (string, error) {
	check := func(name string) bool {
		_, err := exec.LookPath(name)
		return err == nil
	}
	if prefer != "" && prefer != "auto" {
		if !check(prefer) {
			return "", fmt.Errorf("%s CLI not found on PATH", prefer)
		}
		return prefer, nil
	}
	for _, name := range inferenceCLIs {
		if check(name) {
			return name, nil
		}
	}
	return "", fmt.Errorf("no inference CLI found on PATH (tried %s)", strings.Join(inferenceCLIs, ", "))
}

// runInference shells out to the chosen CLI. The full prompt (instructions +
// candidates JSON) goes in via stdin. Every supported CLI accepts this
// pattern.
//
// The CLI runs in its own process group so a timeout or a cancellation
// (SIGTERM/SIGINT reaching this process, e.g. the desktop app stopping a
// generation) can take down the whole tree — the CLI plus anything it
// spawned — instead of orphaning it.
func runInference(ctx context.Context, cli, prompt string, timeout time.Duration) (string, error) {
	var cmd *exec.Cmd
	switch {
	case cli == "claude" || strings.ContainsAny(cli, "/\\"):
		// `claude -p` reads the prompt from stdin when no positional arg is
		// given. A custom path is invoked the same way, claude-style.
		cmd = exec.Command(cli, "-p")
	case cli == "codex":
		// `codex exec -` reads instructions from stdin.
		cmd = exec.Command("codex", "exec", "-")
	case cli == "pi":
		// `pi -p` takes piped stdin as the prompt and prints only the final
		// assistant text. --no-session keeps the brief's own prompt out of
		// ~/.pi/agent/sessions (and so out of tomorrow's scan); --no-tools
		// makes it a pure text completion.
		cmd = exec.Command("pi", "-p", "--no-session", "--no-tools")
	default:
		return "", fmt.Errorf("unknown inference cli: %s", cli)
	}

	cmd.Stdin = strings.NewReader(prompt)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	setProcessGroup(cmd)

	done := make(chan error, 1)
	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("starting %s: %w", cli, err)
	}
	go func() { done <- cmd.Wait() }()

	select {
	case err := <-done:
		if err != nil {
			return "", fmt.Errorf("%s failed: %w\nstderr: %s", cli, err, stderr.String())
		}
	case <-ctx.Done():
		killProcessGroup(cmd)
		<-done
		return "", fmt.Errorf("%s cancelled", cli)
	case <-time.After(timeout):
		killProcessGroup(cmd)
		<-done
		return "", fmt.Errorf("%s timed out after %s", cli, timeout)
	}

	out := stdout.String()
	if cli == "codex" {
		out = stripCodexExecChrome(out)
	}
	return strings.TrimSpace(out), nil
}

// stripCodexExecChrome removes the structured pre/post lines `codex exec`
// prints around the actual model output (timestamp banners, "thinking", etc).
// Conservative: keep everything from the first non-banner line onward, drop a
// trailing "tokens used" line if present.
func stripCodexExecChrome(s string) string {
	lines := strings.Split(s, "\n")
	out := make([]string, 0, len(lines))
	skipBanner := true
	for _, ln := range lines {
		if skipBanner {
			t := strings.TrimSpace(ln)
			if t == "" || strings.HasPrefix(t, "[") || strings.HasPrefix(t, "OpenAI Codex") || strings.HasPrefix(t, "--------") || strings.HasPrefix(t, "workdir:") || strings.HasPrefix(t, "model:") || strings.HasPrefix(t, "provider:") || strings.HasPrefix(t, "approval:") || strings.HasPrefix(t, "sandbox:") || strings.HasPrefix(t, "reasoning") || strings.HasPrefix(t, "user instructions:") {
				continue
			}
			skipBanner = false
		}
		if strings.HasPrefix(strings.TrimSpace(ln), "tokens used:") {
			break
		}
		out = append(out, ln)
	}
	return strings.Join(out, "\n")
}
