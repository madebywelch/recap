//go:build !windows

package main

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// A stub inference CLI: spawns a long-lived child, records the child's pid,
// reads stdin like the real CLIs do, and never exits on its own. The child is
// the point — a naive kill of the CLI process would orphan it.
func writeStubCLI(t *testing.T, dir string) (cliPath, pidFile string) {
	t.Helper()
	cliPath = filepath.Join(dir, "claude")
	pidFile = filepath.Join(dir, "child.pid")
	script := "#!/bin/sh\nsleep 300 &\necho $! > " + pidFile + "\ncat > /dev/null\nwait\n"
	if err := os.WriteFile(cliPath, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return cliPath, pidFile
}

func waitFor(t *testing.T, cond func() bool, what string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func childAlive(pidFile string) bool {
	data, err := os.ReadFile(pidFile)
	if err != nil {
		return false
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		return false
	}
	return syscall.Kill(pid, 0) == nil
}

// Cancelling the context must take down the inference CLI's whole process
// group: the CLI itself and the grandchild it spawned.
func TestRunInferenceCancelKillsProcessGroup(t *testing.T) {
	cliPath, pidFile := writeStubCLI(t, t.TempDir())
	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan error, 1)
	go func() {
		_, err := runInference(ctx, cliPath, "prompt", 30*time.Second)
		done <- err
	}()

	waitFor(t, func() bool { return childAlive(pidFile) }, "stub CLI to spawn its child")
	cancel()

	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "cancelled") {
			t.Fatalf("expected a cancel error, got %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("runInference did not return after cancel")
	}
	waitFor(t, func() bool { return !childAlive(pidFile) }, "the spawned child to die with the group")
}

// The timeout path kills the same way: the group, not just the CLI process.
func TestRunInferenceTimeoutKillsProcessGroup(t *testing.T) {
	cliPath, pidFile := writeStubCLI(t, t.TempDir())

	done := make(chan error, 1)
	go func() {
		_, err := runInference(context.Background(), cliPath, "prompt", 300*time.Millisecond)
		done <- err
	}()

	waitFor(t, func() bool { return childAlive(pidFile) }, "stub CLI to spawn its child")

	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "timed out") {
			t.Fatalf("expected a timeout error, got %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("runInference did not return after the timeout")
	}
	waitFor(t, func() bool { return !childAlive(pidFile) }, "the spawned child to die with the group")
}

// Each CLI gets its own non-interactive invocation with the prompt on
// stdin, and auto walks claude, codex, pi in order: with only pi on PATH,
// auto picks pi and runs it as `pi -p --no-session --no-tools`.
func TestDetectAndRunEachInferenceCLI(t *testing.T) {
	for _, tc := range []struct {
		name, args string
	}{
		{"claude", "-p"},
		{"codex", "exec -"},
		{"pi", "-p --no-session --no-tools"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			stub := "#!/bin/sh\nprintf 'args=%s stdin=' \"$*\"\n/bin/cat\n"
			if err := os.WriteFile(filepath.Join(dir, tc.name), []byte(stub), 0o755); err != nil {
				t.Fatal(err)
			}
			t.Setenv("PATH", dir)

			cli, err := detectInferenceCLI("auto")
			if err != nil || cli != tc.name {
				t.Fatalf("auto picked %q (%v), want %s", cli, err, tc.name)
			}
			out, err := runInference(context.Background(), cli, "the prompt", 5*time.Second)
			if err != nil {
				t.Fatal(err)
			}
			if want := "args=" + tc.args + " stdin=the prompt"; out != want {
				t.Errorf("got %q, want %q", out, want)
			}
		})
	}

	t.Setenv("PATH", t.TempDir())
	if _, err := detectInferenceCLI("auto"); err == nil || !strings.Contains(err.Error(), "no inference CLI found on PATH (tried claude, codex, pi)") {
		t.Errorf("empty PATH: got %v", err)
	}
	if _, err := detectInferenceCLI("pi"); err == nil || err.Error() != "pi CLI not found on PATH" {
		t.Errorf("explicit pi missing: got %v", err)
	}
}
