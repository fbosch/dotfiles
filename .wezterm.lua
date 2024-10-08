local is_windows = package.config:sub(0, 1) == "\\"
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
config.tab_max_width = 128
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
			bg_color = "#191918",
			fg_color = "#9e9e9e",
		},
	},
}

-- window
config.audible_bell = "Disabled"
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
local function Tab_title(tab_info)
	local title = tab_info.tab_title
	-- if the tab title is explicitly set, take that
	if title and #title > 0 then
		return title
	end
	-- Otherwise, use the title from the active pane
	-- in that tab
	return tab_info.active_pane.title
end

function string.starts(String, Start)
	return string.sub(String, 1, string.len(Start)) == Start
end

config.status_update_interval = 1000
wezterm.on("format-tab-title", function(tab, tabs, panes, config, hover, max_width)
	local title = "" .. Tab_title(tab) .. " "

	local tab_title = {
		{ Foreground = { Color = "#636363" } },
		{ Text = " [" .. tab.tab_index + 1 .. "] " },
	}

	if string.starts(title, "nvim") then
		table.insert(tab_title, { Foreground = { Color = "#54a23d" } })
		table.insert(tab_title, { Text = "" })
		title = string.gsub(title, "nvim", "")
	end

	if string.starts(title, "brew") then
		table.insert(tab_title, { Foreground = { Color = "#c0a23d" } })
		table.insert(tab_title, { Text = "" })
		title = string.gsub(title, "brew", "")
	end

	if string.starts(title, "fish") then
		table.insert(tab_title, { Foreground = { Color = "#97bdde" } })
		table.insert(tab_title, { Text = "" })
		title = string.gsub(title, "fish", "")
	end

	if string.starts(title, "wsl") then
		table.insert(tab_title, { Foreground = { Color = "#e95420" } })
		table.insert(tab_title, { Text = "" })
		title = string.gsub(title, "wsl.exe", "")
		title = string.gsub(title, "wslhost.exe", "")
	end

	if string.starts(title, "cargo") then
		table.insert(tab_title, { Foreground = { Color = "#CE412B" } })
		table.insert(tab_title, { Text = "" })
		title = string.gsub(title, "cargo", "")
	end

	if string.starts(title, "lazygit") then
		table.insert(tab_title, { Foreground = { Color = "#e84e32" } })
		table.insert(tab_title, { Text = "" })
		title = string.gsub(title, "lazygit", "")
	end

	if string.starts(title, "git") then
		table.insert(tab_title, { Foreground = { Color = "#e84e32" } })
		if string.starts(title, "git pull") then
			table.insert(tab_title, { Text = "󰓂" })
			title = string.gsub(title, "git pull", "")
		end
		if string.starts(title, "git commit") then
			table.insert(tab_title, { Text = "󰜘" })
			title = string.gsub(title, "git commit", "")
		end
		if string.starts(title, "git push") then
			table.insert(tab_title, { Text = "" })
			title = string.gsub(title, "git push", "")
		end
	end

	table.insert(tab_title, { Foreground = { Color = "#bbbbbb" } })
	table.insert(tab_title, { Text = title })
	return tab_title
end)

local function parse_time(time_str)
	if not time_str then
		return nil
	end
	local hour, minute, second = time_str:match("(%d+):(%d+):(%d+)")
	if not (hour and minute and second) then
		return nil
	end
	return tonumber(hour), tonumber(minute), tonumber(second)
end

local function calculate_hour_difference(time_str1, time_str2)
	if not time_str1 or not time_str2 then
		return nil, "Invalid input: one or both time strings are nil"
	end

	local hour1, minute1, second1 = parse_time(time_str1)
	local hour2, minute2, second2 = parse_time(time_str2)

	if not (hour1 and minute1 and second1 and hour2 and minute2 and second2) then
		return nil, "Invalid input: unable to parse time strings"
	end

	-- Convert times to seconds
	local totalSeconds1 = hour1 * 3600 + minute1 * 60 + second1
	local totalSeconds2 = hour2 * 3600 + minute2 * 60 + second2

	-- Calculate the difference in seconds
	local differenceInSeconds = totalSeconds2 - totalSeconds1

	-- Convert the difference back to hours
	local differenceInHours = differenceInSeconds / 3600

	return differenceInHours
end

if not is_windows then
	wezterm.on("update-right-status", function(window, pane)
		local date = wezterm.strftime("(%Y-%m-%d) %a %b %-d ")
		local time = wezterm.strftime("%H:%M")
		local status = {
			{ Foreground = { Color = "#7c7c7c" } },
			{ Text = date },
			{ Foreground = { Color = "#515151" } },
			{ Text = "▏" },
			{ Foreground = { Color = "#bbbbbb" } },
			{ Text = time },
			{ Foreground = { Color = "#515151" } },
			{ Text = "▕" },
		}

		local wday = os.date("*t").wday
		if wday ~= 1 or wday ~= 7 then
			local first_login = pane:get_user_vars().first_login
			local calculated_hours = calculate_hour_difference(first_login, wezterm.strftime("%H:%M:%S"))
			local hours_worked = calculated_hours or 0

			if hours_worked > 0 and hours_worked < 10 then
				local icon = ""
				table.insert(status, { Text = " " })
				if hours_worked > 8 then
					icon = wezterm.nerdfonts.fa_hourglass_o
					table.insert(status, { Foreground = { Color = "#d79999" } })
				elseif hours_worked >= 7 then
					icon = wezterm.nerdfonts.fa_hourglass_o
					table.insert(status, { Foreground = { Color = "#819B69" } })
				elseif hours_worked >= 5 then
					icon = wezterm.nerdfonts.fa_hourglass_end
					table.insert(status, { Foreground = { Color = "#d2af0d" } })
				elseif hours_worked >= 2 then
					icon = wezterm.nerdfonts.fa_hourglass_half
					table.insert(status, { Foreground = { Color = "#B77E64" } })
				elseif hours_worked <= 2 then
					icon = wezterm.nerdfonts.fa_hourglass_start
					table.insert(status, { Foreground = { Color = "#999999" } })
				end
				local hours_string = string.format("%.1f", hours_worked)
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
	-- TODO: find better keys for splitting panes
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

if is_windows then
	config.default_domain = "WSL:Ubuntu"
	config.window_decorations = "TITLE | RESIZE"
	config.font_size = 12
else
	config.window_background_opacity = 0.98
	config.macos_window_background_blur = 50
end

function Get_hour_icon(hour)
	local clock_icon = ""
	if hour >= 0 and hour < 1 then
		clock_icon = wezterm.nerdfonts.md_clock_time_one
	elseif hour < 2 then
		clock_icon = wezterm.nerdfonts.md_clock_time_two
	elseif hour < 3 then
		clock_icon = wezterm.nerdfonts.md_clock_time_three
	elseif hour < 4 then
		clock_icon = wezterm.nerdfonts.md_clock_time_four
	elseif hour < 5 then
		clock_icon = wezterm.nerdfonts.md_clock_time_five
	elseif hour < 6 then
		clock_icon = wezterm.nerdfonts.md_clock_time_six
	elseif hour < 7 then
		clock_icon = wezterm.nerdfonts.md_clock_time_seven
	elseif hour < 8 then
		clock_icon = wezterm.nerdfonts.md_clock_time_eight
	elseif hour < 9 then
		clock_icon = wezterm.nerdfonts.md_clock_time_nine
	elseif hour < 10 then
		clock_icon = wezterm.nerdfonts.md_clock_time_ten
	elseif hour < 11 then
		clock_icon = wezterm.nerdfonts.md_clock_time_eleven
	elseif hour < 12 then
		clock_icon = wezterm.nerdfonts.md_clock_time_twelve
	elseif hour < 13 then
		clock_icon = wezterm.nerdfonts.md_clock_time_one
	elseif hour < 14 then
		clock_icon = wezterm.nerdfonts.md_clock_time_two
	elseif hour < 15 then
		clock_icon = wezterm.nerdfonts.md_clock_time_three
	elseif hour < 16 then
		clock_icon = wezterm.nerdfonts.md_clock_time_four
	elseif hour < 17 then
		clock_icon = wezterm.nerdfonts.md_clock_time_five
	elseif hour < 18 then
		clock_icon = wezterm.nerdfonts.md_clock_time_six
	elseif hour < 19 then
		clock_icon = wezterm.nerdfonts.md_clock_time_seven
	elseif hour < 20 then
		clock_icon = wezterm.nerdfonts.md_clock_time_eight
	elseif hour < 21 then
		clock_icon = wezterm.nerdfonts.md_clock_time_nine
	elseif hour < 22 then
		clock_icon = wezterm.nerdfonts.md_clock_time_ten
	elseif hour < 23 then
		clock_icon = wezterm.nerdfonts.md_clock_time_eleven
	else
		clock_icon = wezterm.nerdfonts.md_clock_time_twelve
	end

	return clock_icon
end

return config
