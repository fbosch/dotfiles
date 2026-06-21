#!/usr/bin/env bash

set -euo pipefail

exec "${HOME}/.config/hypr/runtime/desktop/switch-layout.lua" "$@"
