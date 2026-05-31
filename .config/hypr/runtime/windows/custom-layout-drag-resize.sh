#!/usr/bin/env dash
set -eu

. "${HOME}/.config/hypr/runtime/lib/hypr-ipc.sh"

runtime_dir="${XDG_RUNTIME_DIR:-/tmp}/hypr-custom-layout-drag-resize"
state_file="$runtime_dir/state"
pid_file="$runtime_dir/pid"
mode="${1:-start}"
drag_numerator=2
drag_denominator=3

json_string_field() {
  field="$1"
  sed -n "s/.*\"$field\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p"
}

json_number_field() {
  field="$1"
  sed -n "s/.*\"$field\"[[:space:]]*:[[:space:]]*\(-\{0,1\}[0-9][0-9]*\).*/\1/p"
}

active_monitor_name() {
  if command -v jq >/dev/null 2>&1; then
    monitor_id="$(hypr_query 'j/activewindow' | jq -r '.monitor // empty')"
    [ -n "$monitor_id" ] || return 1
    hypr_query 'j/monitors' | jq -r --argjson id "$monitor_id" '.[] | select(.id == $id) | .name' | sed -n '1p'
    return
  fi

  active_monitor_id="$(hypr_query 'j/activewindow' | json_number_field 'monitor')"
  case "$active_monitor_id" in
    0) printf 'HDMI-A-2\n' ;;
    1) printf 'DP-2\n' ;;
    *) return 1 ;;
  esac
}

cursor_axis() {
  axis="$1"
  hypr_query 'j/cursorpos' | json_number_field "$axis"
}

active_geometry() {
  window_info="$(hypr_query 'activewindow' || true)"
  x=""
  y=""
  width=""
  height=""

  while IFS= read -r line; do
    case "$line" in
      *at:* )
        geometry="${line#at: }"
        geometry="${geometry#*: }"
        x="${geometry%%,*}"
        y="${geometry#*,}"
        ;;
      *size:* )
        geometry="${line#size: }"
        geometry="${geometry#*: }"
        width="${geometry%%,*}"
        height="${geometry#*,}"
        ;;
    esac
  done <<EOF
$window_info
EOF

  [ -n "$x" ] && [ -n "$y" ] && [ -n "$width" ] && [ -n "$height" ] || return 1
  printf '%s %s %s %s\n' "$x" "$y" "$width" "$height"
}

resize_edge() {
  axis="$1"
  cursor="$2"
  geometry="$3"
  set -- $geometry
  x="$1"
  y="$2"
  width="$3"
  height="$4"

  if [ "$axis" = "x" ]; then
    midpoint=$((x + width / 2))
    [ "$cursor" -lt "$midpoint" ] && printf 'left\n' || printf 'right\n'
    return
  fi

  midpoint=$((y + height / 2))
  [ "$cursor" -lt "$midpoint" ] && printf 'up\n' || printf 'down\n'
}

stop_drag() {
  if [ -f "$pid_file" ]; then
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
    fi
  fi

  rm -f "$state_file" "$pid_file"
}

start_native_resize() {
  hypr_dispatch_lua 'hl.dsp.window.resize()' || true
}

drag_loop() {
  axis="$1"
  command="$2"
  edge="$3"
  initial="$4"
  ticks=0

  while [ -f "$state_file" ] && [ "$ticks" -lt 1200 ]; do
    current="$(cursor_axis "$axis" || true)"
    if [ -n "$current" ]; then
      scaled=$((initial + (current - initial) * drag_numerator / drag_denominator))
      hypr_dispatch_lua "hl.dsp.layout(\"$command $edge $scaled\")" || true
    fi

    ticks=$((ticks + 1))
    sleep 0.016
  done

  stop_drag
}

case "$mode" in
  stop)
    stop_drag
    exit 0
    ;;
  start)
    mkdir -p "$runtime_dir"
    stop_drag

    monitor_name="$(active_monitor_name || true)"
    case "$monitor_name" in
      DP-2)
        axis="x"
        command="resize-x-at"
        ;;
      HDMI-A-2)
        axis="y"
        command="resize-y-at"
        ;;
      *)
        start_native_resize
        exit 0
        ;;
    esac

    previous="$(cursor_axis "$axis" || true)"
    if [ -z "$previous" ]; then
      exit 0
    fi

    geometry="$(active_geometry || true)"
    if [ -z "$geometry" ]; then
      exit 0
    fi

    edge="$(resize_edge "$axis" "$previous" "$geometry")"

    : >"$state_file"
    drag_loop "$axis" "$command" "$edge" "$previous" &
    printf '%s\n' "$!" >"$pid_file"
    ;;
  *)
    printf 'usage: %s start|stop\n' "$0" >&2
    exit 2
    ;;
esac
