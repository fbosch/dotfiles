local wezterm = require("wezterm")
local scanlines_path = wezterm.config_dir .. "/scanlines.png"
local palette = require("theme")
local is_hyprland = wezterm.target_triple:find("linux") ~= nil and os.getenv("HYPRLAND_INSTANCE_SIGNATURE") ~= nil

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
			opacity = 0.975,
		},
		{
			source = {
				File = scanlines_path,
			},
			width = "1px",
			height = "1cell",
			repeat_x = "Repeat",
			repeat_y = "Repeat",
			opacity = 0.66,
		},
	}
	if is_hyprland == false then
		return
	end

	-- Keep scanlines out of the side padding so they do not brighten the inset border.
	table.insert(config.background, {
		source = {
			Color = palette.background,
		},
		width = "1px",
		height = "100%",
		repeat_x = "NoRepeat",
		repeat_y = "NoRepeat",
	})
	table.insert(config.background, {
		source = {
			Color = palette.background,
		},
		width = "1px",
		height = "100%",
		horizontal_align = "Right",
		repeat_x = "NoRepeat",
		repeat_y = "NoRepeat",
	})
end
