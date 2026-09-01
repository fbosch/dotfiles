#!/usr/bin/env bash

set -euo pipefail

target_home="${1:-$HOME}"

install -d -m 0700 "$target_home/.pi/agent"
