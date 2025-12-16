#!/usr/bin/env bash
# Generate an SVG icon from a Nerd Font character
# Usage: nerd-icon-gen.sh "󰣇" [size] [color] [output_path]

set -euo pipefail

CHAR="${1:-}"
SIZE="${2:-64}"
COLOR="${3:-white}"
OUTPUT="${4:-/tmp/nerd-icon-temp.svg}"

if [[ -z "$CHAR" ]]; then
  echo "Usage: $0 <character> [size=64] [color=white] [output_path]" >&2
  exit 1
fi

# Generate SVG using printf (faster than cat heredoc)
# Use proper viewBox (100x100) with centered text to avoid clipping
printf '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y="50" font-family="JetBrainsMonoNL Nerd Font, JetBrainsMono Nerd Font, Symbols Nerd Font, monospace" font-size="80" fill="%s" text-anchor="middle" dominant-baseline="central">%s</text></svg>\n' "$COLOR" "$CHAR" > "$OUTPUT"

echo "$OUTPUT"
