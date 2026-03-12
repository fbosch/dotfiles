local is_windows = package.config:sub(0, 1) == "\\"
local wezterm = require("wezterm")

-- Pre-allocate color tables to reduce allocations
local color_gray = { Color = "#7c7c7c" }
local color_separator = { Color = "#515151" }
local color_white = { Color = "#bbbbbb" }

-- Reusable status table structure
local status = {}

local function update_right_status(window)
	local date = wezterm.strftime("(%Y-%m-%d) %a %b %-d ")
	local time = wezterm.strftime("%H:%M")
	local week_number = os.date("%V")

	-- Reset and reuse the status table
	status = {
		{ Foreground = color_gray },
		{ Text = date },
		{ Foreground = color_separator },
		{ Text = "▏" },
		{ Foreground = color_gray },
		{ Text = wezterm.nerdfonts.cod_calendar .. " " .. tonumber(week_number) },
		{ Foreground = color_separator },
		{ Text = " ▏" },
		{ Foreground = color_white },
		{ Text = time },
		{ Foreground = color_separator },
		{ Text = "▕" },
	}

	window:set_right_status(wezterm.format(status))
end

return function(config)
	if not is_windows then
		wezterm.on("update-right-status", update_right_status)
	end
end
