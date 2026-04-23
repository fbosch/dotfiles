#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
OPENCODE_DIR="$(dirname -- "$SCRIPT_DIR")"
LIBEXEC_DIR="$OPENCODE_DIR/libexec"

bun --cwd "$LIBEXEC_DIR" --install=auto "$LIBEXEC_DIR/azure/ado_pbi_fetch.ts" "${1:-}"
