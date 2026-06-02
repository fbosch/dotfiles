#!/usr/bin/env bash

set -euo pipefail

exec "${HOME}/.config/hypr/runtime/windows/minimized-state.lua" toggle-workspace "$@"
