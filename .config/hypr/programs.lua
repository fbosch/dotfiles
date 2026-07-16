-- Program commands ported from hyprland.conf.

return {
	terminal = "uwsm-app -s a -- mullvad-exclude wezterm",
	file_manager = "uwsm-app -s a -- nemo",
	browser = "uwsm-app -s a -- flatpak run app.zen_browser.zen --new-window about:newtab",
	menu = "vicinae toggle",
}
