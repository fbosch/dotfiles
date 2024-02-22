local is_windows = package.config:sub(1, 1) == "\\"
local wezterm = require("wezterm")
local config = wezterm.config_builder()

config.max_fps = 120

-- fonts
config.font = wezterm.font_with_fallback({
	{
		family = "JetBrains Mono",
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
config.hide_tab_bar_if_only_one_tab = false

-- This function returns the suggested title for a tab.
-- It prefers the title that was set via `tab:set_title()`
-- or `wezterm cli set-tab-title`, but falls back to the
-- title of the active pane in that tab.
local function tab_title(tab_info)
	local title = tab_info.tab_title
	-- if the tab title is explicitly set, take that
	if title and #title > 0 then
		return title
	end
	-- Otherwise, use the title from the active pane
	-- in that tab
	return tab_info.active_pane.title
end

wezterm.on("format-tab-title", function(tab, tabs, panes, config, hover, max_width)
	local title = "" .. tab_title(tab) .. " "

	local tab_title = {
		{ Foreground = { Color = "#636363" } },
		{ Text = " [" .. tab.tab_index + 1 .. "] " },
	}

	if string.find(title, "nvim") then
		table.insert(tab_title, { Foreground = { Color = "#54a23d" } })
		table.insert(tab_title, { Text = "" })
		title = string.gsub(title, "nvim", "")
	end

	if string.find(title, "brew") then
		table.insert(tab_title, { Foreground = { Color = "#c0a23d" } })
		table.insert(tab_title, { Text = "" })
		title = string.gsub(title, "brew", "")
	end

	if string.find(title, "fish") then
		table.insert(tab_title, { Foreground = { Color = "#97bdde" } })
		table.insert(tab_title, { Text = "" })
		title = string.gsub(title, "fish", "")
	end

	if string.find(title, "wsl") then
		table.insert(tab_title, { Foreground = { Color = "#e95420" } })
		table.insert(tab_title, { Text = "" })
		title = string.gsub(title, "wsl.exe", "")
		title = string.gsub(title, "wslhost.exe", "")
	end

	if string.find(title, "cargo") then
		table.insert(tab_title, { Foreground = { Color = "#CE412B" } })
		table.insert(tab_title, { Text = "" })
		title = string.gsub(title, "cargo", "")
	end

	if string.find(title, "lazygit") then
		table.insert(tab_title, { Foreground = { Color = "#e84e32" } })
		table.insert(tab_title, { Text = "" })
		title = string.gsub(title, "lazygit", "")
	end

	table.insert(tab_title, { Foreground = { Color = "#bbbbbb" } })
	table.insert(tab_title, { Text = title })
	return tab_title
end)

if not is_windows then
	wezterm.on("update-right-status", function(window, pane)
		local date = wezterm.strftime("%a %b %-d ")
		local time = wezterm.strftime("%H:%M")

		local status = {
			{ Foreground = { Color = "#636363" } },
			{ Text = date },
			{ Foreground = { Color = "#bbbbbb" } },
			{ Text = time },
		}

		local wday = os.date("*t").wday
		if wday ~= 1 or wday ~= 7 then
			local hours_worked = tonumber(pane:get_user_vars().hours_worked) or 0
			if hours_worked > 0 then
				local icon = wezterm.nerdfonts.fa_hourglass_start
				table.insert(status, { Text = " " })
				if hours_worked > 8 then
					icon = wezterm.nerdfonts.fa_hourglass_o
					table.insert(status, { Foreground = { Color = "#DE6E7C" } })
				elseif hours_worked >= 7 then
					icon = wezterm.nerdfonts.fa_hourglass_end
					table.insert(status, { Foreground = { Color = "#819B69" } })
				elseif hours_worked >= 5 then
					icon = wezterm.nerdfonts.fa_hourglass_half
					table.insert(status, { Foreground = { Color = "#d2af0d" } })
				elseif hours_worked <= 3 then
					icon = wezterm.nerdfonts.fa_hourglass_half
					table.insert(status, { Foreground = { Color = "#B77E64" } })
				else
					table.insert(status, { Foreground = { Color = "#999999" } })
				end
				local hours_string = string.format("%.1f", math.floor(hours_worked * 2 + 0.5) / 2)
				hours_string = string.gsub(hours_string, "%.0", "")
				table.insert(status, { Text = icon .. " " .. hours_string .. " " })
			end
		end

		window:set_right_status(wezterm.format(status))
	end)
end

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
		key = "v",
		mods = "CTRL|SHIFT",
		action = wezterm.action.SplitHorizontal({ domain = "CurrentPaneDomain" }),
	},
	{
		key = "s",
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

if is_windows then
	config.default_domain = "WSL:Ubuntu"
	config.window_decorations = "TITLE | RESIZE"
	config.font_size = 12
else
	config.window_background_opacity = 0.98
	config.macos_window_background_blur = 50
end

return config
