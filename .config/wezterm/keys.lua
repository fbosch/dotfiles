local wezterm = require("wezterm")
local is_macos = wezterm.target_triple:find("darwin") ~= nil

local macos_tab_keys = {
	["1"] = "raw:18",
	["2"] = "raw:19",
	["3"] = "raw:20",
	["4"] = "raw:21",
	["5"] = "raw:23",
	["6"] = "raw:22",
	["7"] = "raw:26",
	["8"] = "raw:28",
	["9"] = "raw:25",
}

local function activate_tab_key(number, tab_index)
	return {
		key = is_macos and macos_tab_keys[number] or number,
		mods = "CTRL|SHIFT",
		action = wezterm.action.ActivateTab(tab_index),
	}
end

return function(config)
	config.keys = {
		-- Raw macOS codes avoid Shift+number mapped-character mismatches.
		activate_tab_key("1", 0),
		activate_tab_key("2", 1),
		activate_tab_key("3", 2),
		activate_tab_key("4", 3),
		activate_tab_key("5", 4),
		activate_tab_key("6", 5),
		activate_tab_key("7", 6),
		activate_tab_key("8", 7),
		activate_tab_key("9", 8),
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
