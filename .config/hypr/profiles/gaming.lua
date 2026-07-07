local command = require("lib.command")

return {
	on_apply = function()
		command.ok(command.line("hyprctl", "setprop", ".*", "opacity", "1.0") .. " >/dev/null 2>&1")
		command.ok(command.line("hyprctl", "setprop", ".*", "opacity_inactive", "1.0") .. " >/dev/null 2>&1")
		command.ok(command.line("hyprctl", "setprop", ".*", "opacity_fullscreen", "1.0") .. " >/dev/null 2>&1")
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
