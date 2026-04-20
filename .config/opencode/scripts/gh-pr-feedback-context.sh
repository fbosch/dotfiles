#!/usr/bin/env bash
set -euo pipefail

RAW_INPUT="${1:-}"
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

REQUIRED=(
  "gh-pr-identify.sh"
  "gh-pr-fetch-context.sh"
  "gh-pr-normalize-feedback.py"
  "gh-pr-match-addressed.py"
)

declare -a CANDIDATES=()
declare -A SEEN=()

add_candidate() {
  local dir="$1"
  if [[ -z "$dir" ]]; then
    return
  fi
  if [[ -d "$dir" ]]; then
    :
  else
    return
  fi
  if [[ -n "${SEEN[$dir]:-}" ]]; then
    return
  fi
  SEEN["$dir"]=1
  CANDIDATES+=("$dir")
}

add_candidate "$SELF_DIR"
add_candidate "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/scripts"
add_candidate "$HOME/.config/opencode/scripts"
add_candidate "$HOME/dotfiles/.config/opencode/scripts"

has_all_required() {
  local base="$1"
  local name
  for name in "${REQUIRED[@]}"; do
    if [[ -f "$base/$name" ]]; then
      :
    else
      return 1
    fi
  done
  return 0
}

SCRIPT_BASE=""
for dir in "${CANDIDATES[@]}"; do
  if has_all_required "$dir"; then
    SCRIPT_BASE="$dir"
    break
  fi
done

if [[ -z "$SCRIPT_BASE" ]]; then
  checked=""
  for dir in "${CANDIDATES[@]}"; do
    if [[ -n "$checked" ]]; then
      checked="$checked, "
    fi
    checked="$checked$dir"
  done
  echo "ERROR: Missing gh-pr helper scripts. Checked: $checked"
  exit 0
fi

OUTPUT="$(bash "$SCRIPT_BASE/gh-pr-fetch-context.sh" "$RAW_INPUT" | python3 "$SCRIPT_BASE/gh-pr-normalize-feedback.py" | python3 "$SCRIPT_BASE/gh-pr-match-addressed.py" 2>&1 || true)"

if [[ -z "$OUTPUT" ]]; then
  echo "ERROR: Script-generated review context missing."
  exit 0
fi

if [[ "$OUTPUT" == ERROR:* ]]; then
  echo "$OUTPUT"
  exit 0
fi

python3 - <<'PY' "$OUTPUT"
import json
import sys

raw = sys.argv[1]

try:
    payload = json.loads(raw)
except json.JSONDecodeError as error:
    print(f"ERROR: Invalid JSON from context pipeline: {error}")
    sys.exit(0)

if isinstance(payload, dict) is False:
    print("ERROR: Script-generated review context missing.")
    sys.exit(0)

if "threads" not in payload:
    print("ERROR: Script-generated review context missing.")
    sys.exit(0)

print(json.dumps(payload))
PY
