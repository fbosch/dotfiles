#!/usr/bin/env bash
# Generate an SVG icon from a Nerd Font character
# Usage: nerd-icon-gen.sh "󰣇" [size] [color] [output_path]

set -euo pipefail

CHAR="${1:-}"
SIZE="${2:-64}"
COLOR="${3:-white}"

if [[ -z "$CHAR" ]]; then
  echo "Usage: $0 <character> [size=64] [color=white] [output_path]" >&2
  exit 1
fi

# If output path is provided, use it; otherwise generate unique path based on icon and color
if [[ -n "${4:-}" ]]; then
  OUTPUT="$4"
else
  # Generate unique filename based on character codepoint and color hash
  # Use printf to get hex codepoint, md5sum for color hash
  CHAR_HASH=$(printf "%s" "$CHAR" | md5sum | cut -c1-8)
  COLOR_HASH=$(printf "%s" "$COLOR" | md5sum | cut -c1-8)
  OUTPUT="/tmp/nerd-icon-${CHAR_HASH}-${COLOR_HASH}.svg"
fi

# Generate SVG using printf (faster than cat heredoc)
# Use proper viewBox (100x100) with centered text to avoid clipping
printf '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y="50" font-family="JetBrainsMonoNL Nerd Font, JetBrainsMono Nerd Font, Symbols Nerd Font, monospace" font-size="80" fill="%s" text-anchor="middle" dominant-baseline="central">%s</text></svg>\n' "$COLOR" "$CHAR" > "$OUTPUT"

echo "$OUTPUT"
