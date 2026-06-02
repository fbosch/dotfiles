#!/usr/bin/env bash

set -euo pipefail

exec "${HOME}/.config/hypr/runtime/windows/daemons/window-capture/window-capture-daemon.lua" "$@"
