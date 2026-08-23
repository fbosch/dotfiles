#!/usr/bin/env dash

# Shell-facing shim for the single ags-ipc implementation. The parser and the
# busctl/ags fallback live in runtime/lib/ags-ipc.lua; this preserves the
# `ags_request <component> [payload]` contract for dash callers.

ags_request() {
  luajit "$HOME/.config/hypr/runtime/lib/ags-request.lua" "$1" "${2:-}"
}
