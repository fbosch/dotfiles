local wezterm = require("wezterm")
local config = wezterm.config_builder()

config.max_fps = 120

-- fonts
config.font = wezterm.font_with_fallback({
	{
		family = "JetBrainsMono Nerd Font Mono",
		harfbuzz_features = { "calt=0", "clig=0", "liga=0" },
	},
	"Noto Sans Runic",
	{ family = "Symbols Nerd Font Mono", scale = 0.8 },
	"Apple Color Emoji",
	"Segoe UI Emoji",
})
config.font_size = 16.0
config.underline_thickness = "0.1cell"
config.underline_position = "-0.11cell"
config.cursor_thickness = 1
config.custom_block_glyphs = true

-- colors
config.color_scheme = "zenwritten_dark"
config.tab_max_width = 32
config.show_new_tab_button_in_tab_bar = false
config.colors = {
	tab_bar = {
		background = "#191919",
		active_tab = {
			bg_color = "#252525",
			fg_color = "#ffffff",
			intensity = "Normal",
		},
		inactive_tab = {
			bg_color = "#191919",
			fg_color = "#9e9e9e",
		},
	},
}

-- window
config.window_decorations = "RESIZE|MACOS_FORCE_DISABLE_SHADOW"
config.window_padding = {
	left = 2,
	right = 2,
	top = -1,
	bottom = 0,
}

-- tabs
config.tab_bar_at_bottom = true
config.use_fancy_tab_bar = false
config.hide_tab_bar_if_only_one_tab = true

config.skip_close_confirmation_for_processes_named = {
	"bash",
	"sh",
	"zsh",
	"fish",
	"tmux",
	"nu",
	"cmd.exe",
	"pwsh.exe",
	"powershell.exe",
	"starship",
}

config.keys = {
	{
		key = "Enter",
		mods = "CTRL",
		action = wezterm.action.SplitHorizontal({ domain = "CurrentPaneDomain" }),
	},
	{
		key = "Enter",
		mods = "CTRL|SHIFT",
		action = wezterm.action.SplitVertical({ domain = "CurrentPaneDomain" }),
	},
	{
		key = "l",
		mods = "CTRL|SHIFT",
		action = wezterm.action.ActivatePaneDirection("Right"),
	},
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

local is_windows = package.config:sub(1, 1) == "\\"

if is_windows then
	config.default_domain = "WSL:Ubuntu"
	config.window_decorations = "TITLE | RESIZE"
	config.font_size = 12
else
	config.window_background_opacity = 0.98
	config.macos_window_background_blur = 50
end

return config
