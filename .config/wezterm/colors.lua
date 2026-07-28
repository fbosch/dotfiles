local wezterm = require("wezterm")
local scanlines_path = wezterm.config_dir .. "/scanlines.png"
local palette = require("theme")

return function(config)
	config.color_scheme = "zenwritten_dark"
	config.colors = {
		background = palette.background,
		tab_bar = {
			background = palette.background,
			active_tab = {
				bg_color = palette.semantic.tab_active_background,
				fg_color = palette.semantic.active_foreground,
				intensity = "Normal",
			},
			inactive_tab = {
				bg_color = palette.semantic.tab_inactive_background,
				fg_color = palette.semantic.muted,
			},
		},
	}
	config.background = {
		{
			source = {
				Color = palette.background,
			},
			width = "100%",
			height = "100%",
			opacity = 0.97,
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
