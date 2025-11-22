return function(config)
	config.color_scheme = "zenwritten_dark"
	config.colors = {
		tab_bar = {
			background = "#191919",
			active_tab = {
				bg_color = "#262626",
				fg_color = "#b7b7b7",
				intensity = "Normal",
			},
			inactive_tab = {
				bg_color = "#191918",
				fg_color = "#636363",
			},
		},
	}
	config.background = {
		{
			source = {
				Color = "#191919",
			},
			width = "100%",
			height = "100%",
			opacity = 0.95,
		},
		{
			source = {
				File = os.getenv("HOME") .. "/.config/wezterm/scanlines.png",
			},
			width = "1px",
			height = "1cell",
			repeat_x = "Repeat",
			repeat_y = "Repeat",
			opacity = 1,
		},
	}
end
