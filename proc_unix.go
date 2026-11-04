//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

// setProcessGroup starts the inference CLI as its own process-group leader,
// so killProcessGroup can take down the CLI and everything it spawned.
func setProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// killProcessGroup kills the process group led by cmd — SIGKILL to the
// negative pid. A no-op if the process is already gone.
func killProcessGroup(cmd *exec.Cmd) {
	if cmd.Process != nil {
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
}
