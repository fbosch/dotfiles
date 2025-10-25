#!/bin/bash

# Resolve the current GTK icon theme so we can use its keyboard icon in notifications
get_icon_theme() {
    local theme=""

    if command -v gsettings >/dev/null 2>&1; then
        theme=$(gsettings get org.gnome.desktop.interface icon-theme 2>/dev/null | tr -d "'")
    fi

    if [[ -z "$theme" || "$theme" == "@as" ]]; then
        theme=${GTK_ICON_THEME:-${GTK_THEME:-}}
        theme=${theme%%:*}
    fi

    if [[ -n "$theme" ]]; then
        echo "$theme"
    else
        echo "hicolor"
    fi
}

find_keyboard_icon() {
    local icon_theme="$1"
    local -a icon_candidates=("input-keyboard-symbolic" "input-keyboard" "keyboard" "preferences-desktop-keyboard")
    local -a icon_roots=("$HOME/.local/share/icons" "$HOME/.icons" "/usr/share/icons")
    local candidate root theme_dir icon_path

    for candidate in "${icon_candidates[@]}"; do
        for root in "${icon_roots[@]}"; do
            [[ -d "$root" ]] || continue
            for theme_dir in "$root/$icon_theme" "$root/hicolor"; do
                [[ -d "$theme_dir" ]] || continue
                icon_path=$(find "$theme_dir" -type f \( -name "${candidate}.svg" -o -name "${candidate}.png" -o -name "${candidate}.xpm" \) -print -quit 2>/dev/null)
                if [[ -n "$icon_path" ]]; then
                    echo "$icon_path"
                    return
                fi
            done
        done
    done

    # Fallback to an icon name so notify-send can resolve it via the current theme
    echo "${icon_candidates[0]}"
}

gtk_icon_theme=$(get_icon_theme)
keyboard_icon=$(find_keyboard_icon "$gtk_icon_theme")

# Get current keyboard layout from the main keyboard
current_layout=$(hyprctl devices | grep -A 10 "at-translated-set-2-keyboard" | grep "active keymap:" | sed 's/.*active keymap: //')

# Define layouts array with display names and flag emojis
layouts=("us" "dk")
layout_names=("English (US)" "Danish")
layout_flags=("🇺🇸" "🇩🇰")

# Find current layout index
current_index=0
for i in "${!layouts[@]}"; do
    if [[ "${layout_names[$i]}" == "$current_layout" ]]; then
        current_index=$i
        break
    fi
done

# Get the flag emoji for the current layout
current_flag="${layout_flags[$current_index]}"

# Calculate next layout index
next_index=$(( (current_index + 1) % ${#layouts[@]} ))
next_layout="${layouts[$next_index]}"

# Switch to next layout
hyprctl switchxkblayout at-translated-set-2-keyboard next

# Wait a moment for the layout to change
sleep 0.1

# Get the new layout after switching
new_layout=$(hyprctl devices | grep -A 10 "at-translated-set-2-keyboard" | grep "active keymap:" | sed 's/.*active keymap: //')

# Find the flag emoji for the new layout
new_flag="🇺🇸"  # default to US flag
for i in "${!layouts[@]}"; do
    if [[ "${layout_names[$i]}" == "$new_layout" ]]; then
        new_flag="${layout_flags[$i]}"
        break
    fi
done

# Send notification with the new layout, flag, and keyboard icon
notification_body="$new_flag Switched to: $new_layout"
notify_args=(--app-name "Layout Switcher" --hint=int:transient:1 -t 1000)

[[ -n "$keyboard_icon" ]] && notify_args+=(-i "$keyboard_icon")

notification_id_file="${XDG_RUNTIME_DIR:-/tmp}/hypr-layout-notification.id"
if [[ -f "$notification_id_file" ]]; then
    previous_id=$(<"$notification_id_file")
    [[ -n "$previous_id" ]] && notify_args+=(--replace-id "$previous_id")
fi

new_notification_id=$(notify-send "${notify_args[@]}" --print-id "Keyboard Layout" "$notification_body")
if [[ -n "$new_notification_id" ]]; then
    printf '%s\n' "$new_notification_id" > "$notification_id_file"
fi

# Also log to hyprland log for debugging
echo "Keyboard layout switched from $current_layout to $new_layout" >> /tmp/hyprland-layout.log
