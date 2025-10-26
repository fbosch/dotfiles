#!/usr/bin/env bash

set -euo pipefail

mode="${1:-toggle}"

state_dir="${XDG_STATE_HOME:-${XDG_RUNTIME_DIR:-$HOME/.local/state}}"
state_file="${state_dir}/waybar-visible.state"
momentary_file="${state_dir}/waybar-momentary.state"
lock_file="${state_dir}/waybar-state.lock"

mkdir -p "${state_dir}"
exec 9>"${lock_file}"
flock 9

if [ ! -f "${state_file}" ]; then
    printf 'hidden\n' > "${state_file}"
fi

waybar_names=(waybar .waybar-wrapped)

waybar_running() {
    for name in "${waybar_names[@]}"; do
        if pgrep -x "${name}" >/dev/null 2>&1; then
            return 0
        fi
    done
    return 1
}

ensure_waybar() {
    if ! waybar_running; then
        nohup waybar >/dev/null 2>&1 &
    fi
}

signal_waybar() {
    local signal="$1"
    local delivered=false

    for name in "${waybar_names[@]}"; do
        if pkill -"${signal}" -x "${name}" >/dev/null 2>&1; then
            delivered=true
        fi
    done

    if [ "${delivered}" = false ]; then
        pkill -"${signal}" -f "waybar" >/dev/null 2>&1 || true
    fi
}

read_state() {
    if [ -f "${state_file}" ]; then
        head -n1 "${state_file}"
    else
        echo "hidden"
    fi
}

write_state() {
    printf '%s\n' "$1" > "${state_file}"
}

waybar_visible() {
    if [ "$(read_state)" = "visible" ]; then
        return 0
    fi
    return 1
}

show_bar() {
    ensure_waybar
    signal_waybar "SIGUSR1"
    write_state "visible"
}

hide_bar() {
    signal_waybar "SIGUSR2"
    write_state "hidden"
}

toggle_bar() {
    if [ "$(read_state)" = "visible" ]; then
        hide_bar
    else
        show_bar
    fi
}

case "${mode}" in
    show)
        show_bar
        ;;
    hide)
        hide_bar
        ;;
    toggle)
        toggle_bar
        ;;
    *)
        echo "Usage: $0 [show|hide|toggle]" >&2
        exit 1
        ;;
esac
