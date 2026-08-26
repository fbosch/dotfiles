-- Look and feel ported from appearance.conf.

hl.config({
	general = {
		gaps_in = 2,
		gaps_out = 5,
		border_size = 1,
		col = {
			active_border = "rgba(191919ff)",
			inactive_border = "rgba(191919ff)",
		},
		resize_on_border = true,
		extend_border_grab_area = 15,
		allow_tearing = false,
		layout = "dwindle",
	},
	layout = {
		single_window_aspect_ratio = "6.5 4",
		single_window_aspect_ratio_tolerance = 0.1,
	},
	decoration = {
		rounding = 8,
		rounding_power = 4.0,
		active_opacity = 1.0,
		inactive_opacity = 0.96,
		shadow = {
			enabled = false,
		},
		blur = {
			enabled = true,
			-- variant = "acrylic",
			acrylic = {
				refraction = 5,
				bulb = 4.5,
				clarity = 0.00,
				aberration = 0.25,
			},
			size = 10,
			special = true,
			popups = true,
			popups_ignorealpha = 0.5,
			passes = 3,
			ignore_opacity = false,
			new_optimizations = true,
			brightness = 1,
			contrast = 1,
			noise = 0.03, -- frosted glass look
			vibrancy = 0.5,
			vibrancy_darkness = 0.35,
			input_methods = true,
			input_methods_ignorealpha = 0.8,
		},
	},
	dwindle = {
		force_split = 2,
		preserve_split = true,
		default_split_ratio = 0.67,
	},
	master = {
		mfact = 0.67,
		new_status = "master",
		new_on_top = true,
		orientation = "left",
		center_master_fallback = "left",
		slave_count_for_center_master = 2,
	},
	scrolling = {
		column_width = 1.0,
		fullscreen_on_one_column = true,
	},
	misc = {
		vrr = 3,
		animate_manual_resizes = false,
		animate_mouse_windowdragging = false,
		force_default_wallpaper = -1,
		disable_hyprland_logo = true,
		disable_watchdog_warning = true,
		disable_splash_rendering = true,
		disable_hyprland_guiutils_check = true,
		mouse_move_focuses_monitor = true,
		on_focus_under_fullscreen = 1,
		initial_workspace_tracking = 0,
	},
})
