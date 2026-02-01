#!/usr/bin/env bash
# Launch the default browser from xdg-settings

desktop_file=$(xdg-settings get default-web-browser)

if [[ -z "$desktop_file" ]]; then
    echo "No default browser set" >&2
    exit 1
fi

# Remove .desktop extension to get app ID
app_id="${desktop_file%.desktop}"

# Check if it's a flatpak app
if flatpak info "$app_id" &>/dev/null; then
    exec uwsm app -s s -- mullvad-exclude flatpak run "$app_id" "$@"
else
    # Fallback to xdg-open for regular apps
    exec uwsm app -s s -- mullvad-exclude xdg-open "http://" "$@"
fi
