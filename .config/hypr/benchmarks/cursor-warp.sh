#!/usr/bin/env bash
set -euo pipefail

iterations="${1:-100}"
script=(luajit "${HOME}/.config/hypr/runtime/windows/warp-cursor-to-active-window.lua")

elapsed_ms() {
  local start="$1"
  local end="$2"
  awk -v start="$start" -v end="$end" 'BEGIN { printf "%.3f", (end - start) * 1000 }'
}

per_call_us() {
  local total_ms="$1"
  awk -v total_ms="$total_ms" -v iterations="$iterations" 'BEGIN { printf "%.3f", total_ms * 1000 / iterations }'
}

start="$(date +%s.%N)"
for ((index = 0; index < iterations; index++)); do
  "${script[@]}"
done
end="$(date +%s.%N)"
script_ms="$(elapsed_ms "$start" "$end")"

lua_code="local n=${iterations}; for _ = 1, n do local w = hl.get_active_window(); local at = w and w.at or nil; local size = w and w.size or nil; if at and size and at.x and at.y and size.x and size.y then hl.dispatch(hl.dsp.cursor.move({ x = at.x + size.x / 2, y = at.y + size.y / 2 })) end end"
start="$(date +%s.%N)"
hyprctl eval "$lua_code" >/dev/null
end="$(date +%s.%N)"
lua_ms="$(elapsed_ms "$start" "$end")"

printf '%-34s %9d iters %10s us/call %8s ms total\n' "cursor-warp/lua-script" "$iterations" "$(per_call_us "$script_ms")" "$script_ms"
printf '%-34s %9d iters %10s us/call %8s ms total\n' "cursor-warp/lua-eval-loop" "$iterations" "$(per_call_us "$lua_ms")" "$lua_ms"
