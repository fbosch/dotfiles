return {
	config = {
		animations = {
			enabled = false,
		},
		decoration = {
			blur = {
				enabled = true,
				size = 6,
				passes = 1,
				special = false,
				popups = false,
				input_methods = false,
				new_optimizations = true,
				noise = 0,
				vibrancy = 0,
			},
			shadow = {
				enabled = false,
			},
			active_opacity = 1.0,
			inactive_opacity = 1.0,
			fullscreen_opacity = 1.0,
		},
		plugin = {
			adaptive_soft_shadow = {
				enabled = true,
			},
		},
		general = {
			allow_tearing = false,
		},
		render = {
			direct_scanout = 2,
		},
	},
}
