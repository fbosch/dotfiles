local wezterm = require("wezterm")
local scanlines_path = wezterm.config_dir .. "/scanlines.png"
local theme = require("lua.theme")

return function(config)
	config.color_scheme = "zenwritten_dark"
	config.colors = {
		tab_bar = {
			background = theme.tab_bar.background,
			active_tab = {
				bg_color = theme.tab_bar.active_bg,
				fg_color = theme.tab_bar.active_fg,
				intensity = "Normal",
			},
			inactive_tab = {
				bg_color = theme.tab_bar.inactive_bg,
				fg_color = theme.tab_bar.inactive_fg,
			},
		},
	}
	config.background = {
		{
			source = {
				Color = theme.base.bg,
			},
			width = "100%",
			height = "100%",
			opacity = 0.98,
		},
		{
			source = {
				File = scanlines_path,
			},
			width = "1px",
			height = "1cell",
			repeat_x = "Repeat",
			repeat_y = "Repeat",
			opacity = 0.6,
		},
	}
end
