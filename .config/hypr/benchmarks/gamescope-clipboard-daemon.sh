#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
hypr_dir="$(cd -- "$script_dir/.." && pwd)"
daemon="$hypr_dir/runtime/gaming/gamescope-clipboard-sync.sh"
run_seconds="${1:-1}"

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

bin_dir="$tmp_dir/bin"
mkdir -p "$bin_dir"

write_fake_tools() {
  cat > "$bin_dir/wl-copy" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

  cat > "$bin_dir/wl-paste" <<'EOF'
#!/usr/bin/env bash
printf 'wl-paste %s\n' "$*" >> "$HYPR_BENCH_LOG"
if [[ "$*" == *"--watch"* ]]; then
  sleep 60
  exit 0
fi
printf 'bench clipboard text'
EOF

  cat > "$bin_dir/xclip" <<'EOF'
#!/usr/bin/env bash
printf 'xclip %s\n' "$*" >> "$HYPR_BENCH_LOG"
cat >/dev/null || true
EOF

  cat > "$bin_dir/pgrep" <<'EOF'
#!/usr/bin/env bash
printf 'pgrep %s\n' "$*" >> "$HYPR_BENCH_LOG"
if [[ "${HYPR_BENCH_GAMESCOPE:-0}" == "1" ]]; then
  printf '123 Xwayland :2 -terminate -force-xrandr-emulation\n'
fi
EOF

  chmod +x "$bin_dir/wl-copy" "$bin_dir/wl-paste" "$bin_dir/xclip" "$bin_dir/pgrep"
}

count_lines() {
  local pattern="$1"
  local file="$2"
  if [[ ! -f "$file" ]]; then
    printf '0'
    return
  fi

  local count=0
  while IFS= read -r line; do
    [[ "$line" == *"$pattern"* ]] && count=$((count + 1))
  done < "$file"
  printf '%s' "$count"
}

run_case() {
  local name="$1"
  local gamescope="$2"
  local log_file="$tmp_dir/$name.log"
  local runtime_dir="$tmp_dir/runtime-$name"
  local start end elapsed_ms wl_paste_watch wl_paste_read xclip_calls pgrep_calls

  : > "$log_file"
  mkdir -p "$runtime_dir"

  start="$(date +%s%3N)"
  PATH="$bin_dir:$PATH" \
    HYPR_BENCH_LOG="$log_file" \
    HYPR_BENCH_GAMESCOPE="$gamescope" \
    XDG_RUNTIME_DIR="$runtime_dir" \
    DISPLAY_CHECK_INTERVAL=0.1 \
    timeout "$run_seconds" "$daemon" >/dev/null 2>&1 || true
  end="$(date +%s%3N)"
  elapsed_ms=$((end - start))

  wl_paste_watch="$(count_lines '--watch' "$log_file")"
  wl_paste_read="$(count_lines 'wl-paste --no-newline' "$log_file")"
  xclip_calls="$(count_lines 'xclip ' "$log_file")"
  pgrep_calls="$(count_lines 'pgrep ' "$log_file")"

  printf '%-22s %5s gamescope %6d ms pgrep=%s wl_read=%s wl_watch=%s xclip=%s\n' \
    "$name" "$gamescope" "$elapsed_ms" "$pgrep_calls" "$wl_paste_read" "$wl_paste_watch" "$xclip_calls"
}

write_fake_tools
run_case "no-display" 0
run_case "with-display" 1
