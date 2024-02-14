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
config.cursor_thickness = 1
config.custom_block_glyphs = true

-- colors
config.color_scheme = "zenwritten_dark"
config.tab_max_width = 64
config.colors = {
	tab_bar = {
		background = "#191919",
		active_tab = {
			bg_color = "#525252",
			fg_color = "#ffffff",
			intensity = "Normal",
		},
		inactive_tab = {
			bg_color = "#2e2e2e",
			fg_color = "#9e9e9e",
		},
	},
}

-- window
config.window_decorations = "RESIZE|MACOS_FORCE_DISABLE_SHADOW"
config.window_padding = {
	left = 0,
	right = 0,
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
