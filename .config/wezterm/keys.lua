local wezterm = require("wezterm")
return function(config)
	config.keys = {
		{
			key = "v",
			mods = "CMD|SHIFT",
			action = wezterm.action.SplitHorizontal({ domain = "CurrentPaneDomain" }),
		},
		{
			key = "s",
			mods = "CMD|SHIFT",
			action = wezterm.action.SplitVertical({ domain = "CurrentPaneDomain" }),
		},
		{
			key = "l",
			mods = "CMD|SHIFT",
			action = wezterm.action.ActivatePaneDirection("Right"),
		},
		{
			key = "h",
			mods = "CMD|SHIFT",
			action = wezterm.action.ActivatePaneDirection("Left"),
		},
		{
			key = "j",
			mods = "CMD|SHIFT",
			action = wezterm.action.ActivatePaneDirection("Down"),
		},
		{
			key = "k",
			mods = "CMD|SHIFT",
			action = wezterm.action.ActivatePaneDirection("Up"),
		},
		{
			key = "RightArrow",
			mods = "CMD|SHIFT",
			action = wezterm.action.AdjustPaneSize({ "Right", 5 }),
		},
		{
			key = "LeftArrow",
			mods = "CMD|SHIFT",
			action = wezterm.action.AdjustPaneSize({ "Left", 5 }),
		},
		{
			key = "UpArrow",
			mods = "CMD|SHIFT",
			action = wezterm.action.AdjustPaneSize({ "Up", 5 }),
		},
		{
			key = "DownArrow",
			mods = "CMD|SHIFT",
			action = wezterm.action.AdjustPaneSize({ "Down", 5 }),
		},
		{
			key = "w",
			mods = "CMD",
			action = wezterm.action.CloseCurrentPane({ confirm = false }),
		},
		{
			key = "RightArrow",
			mods = "CTRL",
			action = wezterm.action.DisableDefaultAssignment,
		},
		{
			key = "LeftArrow",
			mods = "CTRL",
			action = wezterm.action.DisableDefaultAssignment,
		},
	}
end
