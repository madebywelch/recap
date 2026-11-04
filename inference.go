package main

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// detectInferenceCLI returns "claude" or "codex" based on what's on PATH,
// honoring an explicit preference if set. A preference containing a path
// separator is treated as a custom executable (Go's exec.LookPath accepts
// absolute or relative paths directly), so the desktop Settings can pass a
// custom CLI path straight through.
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
	if check("claude") {
		return "claude", nil
	}
	if check("codex") {
		return "codex", nil
	}
	return "", fmt.Errorf("neither claude nor codex CLI found on PATH")
}

// runInference shells out to the chosen CLI. The full prompt (instructions +
// candidates JSON) goes in via stdin. Both CLIs accept this pattern.
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
