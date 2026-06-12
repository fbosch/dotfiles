local wezterm = require("wezterm")
return function(config)
	config.keys = {
		-- Tab switching outside macOS Cmd+number, which is owned by AeroSpace.
		{
			key = "1",
			mods = "CTRL|SHIFT",
			action = wezterm.action.ActivateTab(0),
		},
		{
			key = "2",
			mods = "CTRL|SHIFT",
			action = wezterm.action.ActivateTab(1),
		},
		{
			key = "3",
			mods = "CTRL|SHIFT",
			action = wezterm.action.ActivateTab(2),
		},
		{
			key = "4",
			mods = "CTRL|SHIFT",
			action = wezterm.action.ActivateTab(3),
		},
		{
			key = "5",
			mods = "CTRL|SHIFT",
			action = wezterm.action.ActivateTab(4),
		},
		{
			key = "6",
			mods = "CTRL|SHIFT",
			action = wezterm.action.ActivateTab(5),
		},
		{
			key = "7",
			mods = "CTRL|SHIFT",
			action = wezterm.action.ActivateTab(6),
		},
		{
			key = "8",
			mods = "CTRL|SHIFT",
			action = wezterm.action.ActivateTab(7),
		},
		{
			key = "9",
			mods = "CTRL|SHIFT",
			action = wezterm.action.ActivateTab(8),
		},
		-- Pane splits
		{
			key = "v",
			mods = "CTRL|ALT",
			action = wezterm.action.SplitVertical({ domain = "CurrentPaneDomain" }),
		},
		{
			key = "h",
			mods = "CTRL|ALT",
			action = wezterm.action.SplitHorizontal({ domain = "CurrentPaneDomain" }),
		},
		-- Pane navigation
		{
			key = "h",
			mods = "CTRL|SHIFT",
			action = wezterm.action.ActivatePaneDirection("Left"),
		},
		{
			key = "j",
			mods = "CTRL|SHIFT",
			action = wezterm.action.ActivatePaneDirection("Down"),
		},
		{
			key = "k",
			mods = "CTRL|SHIFT",
			action = wezterm.action.ActivatePaneDirection("Up"),
		},
		{
			key = "l",
			mods = "CTRL|SHIFT",
			action = wezterm.action.ActivatePaneDirection("Right"),
		},
		-- Pane resizing
		{
			key = "RightArrow",
			mods = "CTRL|SHIFT",
			action = wezterm.action.AdjustPaneSize({ "Right", 5 }),
		},
		{
			key = "LeftArrow",
			mods = "CTRL|SHIFT",
			action = wezterm.action.AdjustPaneSize({ "Left", 5 }),
		},
		{
			key = "UpArrow",
			mods = "CTRL|SHIFT",
			action = wezterm.action.AdjustPaneSize({ "Up", 5 }),
		},
		{
			key = "DownArrow",
			mods = "CTRL|SHIFT",
			action = wezterm.action.AdjustPaneSize({ "Down", 5 }),
		},
		-- Close pane
		{
			key = "w",
			mods = "CTRL|SHIFT",
			action = wezterm.action.CloseCurrentPane({ confirm = true }),
		},
		-- Debug overlay for performance monitoring
		{
			key = "D",
			mods = "CTRL|SHIFT",
			action = wezterm.action.ShowDebugOverlay,
		},
		-- Disable default CTRL+arrow assignments
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
