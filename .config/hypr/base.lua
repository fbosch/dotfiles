-- Base compositor settings ported from hyprland.conf.

hl.config({
	general = {
		snap = {
			enabled = true,
			window_gap = 25,
			monitor_gap = 10,
		},
	},
	debug = {
		disable_logs = true,
		enable_stdout_logs = false,
	},
	xwayland = {
		force_zero_scaling = true,
	},
	opengl = {
		nvidia_anti_flicker = true,
	},
	render = {
		direct_scanout = false,
		expand_undersized_textures = false,
	},
})
