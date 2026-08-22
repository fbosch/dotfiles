#!/usr/bin/env bash
set -euo pipefail

exec bun --cwd "$HOME/dotfiles/.config/opencode/libexec" --no-install answer-request/cli.ts "$@"
