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
# Use very small viewBox (10x10) to zoom in and fill space edge-to-edge
printf '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text x="5" y="5" font-family="JetBrainsMonoNL Nerd Font, JetBrainsMono Nerd Font, Symbols Nerd Font, monospace" font-size="10" fill="%s" text-anchor="middle" dominant-baseline="central">%s</text></svg>\n' "$COLOR" "$CHAR" > "$OUTPUT"

echo "$OUTPUT"
