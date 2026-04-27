-- Program commands ported from hyprland.conf.

return {
  terminal = "uwsm-app -s s -- mullvad-exclude wezterm",
  file_manager = "uwsm-app -s s -- nemo",
  browser = "bash ~/.config/hypr/scripts/launch-browser.sh",
  menu = "vicinae toggle",
}
