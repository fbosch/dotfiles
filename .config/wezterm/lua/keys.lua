local wezterm = require("wezterm")
return function(config)
	config.keys = {
		-- Tab switching using raw key codes (works with any keyboard layout)
		-- raw:10-18 are the physical number row keys 1-9
		{
			key = "raw:10",
			mods = "CTRL|SHIFT",
			action = wezterm.action.ActivateTab(0),
		},
		{
			key = "raw:11",
			mods = "CTRL|SHIFT",
			action = wezterm.action.ActivateTab(1),
		},
		{
			key = "raw:12",
			mods = "CTRL|SHIFT",
			action = wezterm.action.ActivateTab(2),
		},
		{
			key = "raw:13",
			mods = "CTRL|SHIFT",
			action = wezterm.action.ActivateTab(3),
		},
		{
			key = "raw:14",
			mods = "CTRL|SHIFT",
			action = wezterm.action.ActivateTab(4),
		},
		{
			key = "raw:15",
			mods = "CTRL|SHIFT",
			action = wezterm.action.ActivateTab(5),
		},
		{
			key = "raw:16",
			mods = "CTRL|SHIFT",
			action = wezterm.action.ActivateTab(6),
		},
		{
			key = "raw:17",
			mods = "CTRL|SHIFT",
			action = wezterm.action.ActivateTab(7),
		},
		{
			key = "raw:18",
			mods = "CTRL|SHIFT",
			action = wezterm.action.ActivateTab(8),
		},
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
