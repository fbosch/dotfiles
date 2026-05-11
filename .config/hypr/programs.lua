-- Program commands ported from hyprland.conf.

return {
  terminal = "uwsm-app -s a -- mullvad-exclude wezterm",
  file_manager = "uwsm-app -s a -- nemo",
  browser = "bash ~/.config/hypr/runtime/desktop/launch-browser.sh",
  menu = "vicinae toggle",
}
