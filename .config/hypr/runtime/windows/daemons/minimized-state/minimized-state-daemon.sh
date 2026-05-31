#!/usr/bin/env bash

set -euo pipefail

exec "${HOME}/.config/hypr/runtime/windows/daemons/minimized-state/minimized-state-daemon.lua" "$@"
