//go:build windows

package main

import "os/exec"

// Windows has no process groups: killing the CLI process is the best
// available hygiene, same as the CLI behaved before the desktop app.
func setProcessGroup(cmd *exec.Cmd) {}

func killProcessGroup(cmd *exec.Cmd) {
	if cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}
