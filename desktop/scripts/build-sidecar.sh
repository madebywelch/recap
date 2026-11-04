#!/bin/sh
# Build the recap Go engine as the Tauri sidecar. Tauri resolves externalBin
# entries as <name>-<target-triple>, so the binary lands in
# src-tauri/binaries/ with the target triple as suffix.
#
# With no argument, builds for the host platform (rustc reports the triple).
# With a target triple, cross-compiles from any platform — Go cross-compiles
# the stdlib-only engine without cgo. macOS first (the primary target):
#   scripts/build-sidecar.sh aarch64-apple-darwin
set -eu

desktop="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$desktop/.." && pwd)"

if ! command -v go >/dev/null 2>&1; then
  echo "build-sidecar: Go is required to build the engine (go.dev/dl)" >&2
  exit 1
fi

triple="${1:-}"
if [ -z "$triple" ]; then
  if ! command -v rustc >/dev/null 2>&1; then
    echo "build-sidecar: rustc is required for the host triple (rustup.rs), or pass a target triple" >&2
    exit 1
  fi
  triple="$(rustc -vV | sed -n 's/^host: //p')"
fi

case "$triple" in
  *-apple-darwin)   goos=darwin ;;
  *-pc-windows-*)   goos=windows ;;
  *-unknown-linux-*) goos=linux ;;
  *) echo "build-sidecar: unknown target triple: $triple" >&2; exit 1 ;;
esac
case "$triple" in
  aarch64-*) goarch=arm64 ;;
  x86_64-*)  goarch=amd64 ;;
  *) echo "build-sidecar: unsupported architecture in $triple" >&2; exit 1 ;;
esac

out="$desktop/src-tauri/binaries/recap-$triple"
if [ "$goos" = "windows" ]; then
  out="$out.exe"
fi

mkdir -p "$(dirname "$out")"
(cd "$repo" && GOOS="$goos" GOARCH="$goarch" go build -trimpath -o "$out" .)
echo "built $out (GOOS=$goos GOARCH=$goarch)"
