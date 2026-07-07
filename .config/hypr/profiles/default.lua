local command = require("lib.command")

return {
	on_apply = function()
		command.ok(command.line("hyprctl", "setprop", ".*", "opacity", "1.0") .. " >/dev/null 2>&1")
		command.ok(command.line("hyprctl", "setprop", ".*", "opacity_inactive", "0.97") .. " >/dev/null 2>&1")
		command.ok(command.line("hyprctl", "setprop", ".*", "opacity_fullscreen", "1.0") .. " >/dev/null 2>&1")
	end,
	config = {
		animations = {
			enabled = true,
		},
		decoration = {
			blur = {
				enabled = true,
				passes = 4,
			},
			shadow = {
				enabled = true,
			},
			active_opacity = 1.0,
			inactive_opacity = 0.97,
			fullscreen_opacity = 1.0,
		},
		misc = {
			vrr = false,
		},
		general = {
			allow_tearing = false,
		},
	}
}
