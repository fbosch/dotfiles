local command = require("lib.command")

return {
	on_apply = function()
		command.ok(command.line("systemctl", "--user", "stop", "hyprwhspr-rs.service") .. " >/dev/null 2>&1")
	end,
	config = {
		animations = {
			enabled = false,
		},
		decoration = {
			blur = {
				enabled = false,
			},
			shadow = {
				enabled = false,
			},
			active_opacity = 1.0,
			inactive_opacity = 1.0,
			fullscreen_opacity = 1.0,
		},
		misc = {
			vrr = 2,
		},
		general = {
			allow_tearing = true,
		},
	},
}
