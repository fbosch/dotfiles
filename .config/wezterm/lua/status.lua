local is_windows = package.config:sub(0, 1) == "\\"
local wezterm = require("wezterm")

-- Pre-allocate color tables to reduce allocations
local color_gray = { Color = "#7c7c7c" }
local color_separator = { Color = "#515151" }
local color_white = { Color = "#bbbbbb" }

-- Reusable status table structure
local status = {}

local function update_right_status(window, pane)
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

	local wday = os.date("*t").wday
	if wday ~= 1 and wday ~= 7 then
		local first_login = pane:get_user_vars().first_login
		local calculated_hours =
			require("lua.utils.time").calculate_hour_difference(first_login, wezterm.strftime("%H:%M:%S"))
		local hours_worked = calculated_hours or 0
		local icon
		local color
		
		table.insert(status, { Text = " " })

		if hours_worked > 0 and hours_worked < 10 then
			if hours_worked > 8 then
				icon = wezterm.nerdfonts.fa_hourglass_o
				color = "#d79999"
			elseif hours_worked >= 7 then
				icon = wezterm.nerdfonts.fa_hourglass_o
				color = "#819B69"
			elseif hours_worked >= 5 then
				icon = wezterm.nerdfonts.fa_hourglass_end
				color = "#d2af0d"
			elseif hours_worked >= 2 then
				icon = wezterm.nerdfonts.fa_hourglass_half
				color = "#B77E64"
			else
				icon = wezterm.nerdfonts.fa_hourglass_start
				color = "#999999"
			end
			table.insert(status, { Foreground = { Color = color } })
			local hours_string = string.format("%.1f", hours_worked):gsub("%.0", "")
			table.insert(status, { Text = icon .. " " .. hours_string .. " " })
		else
			icon = wezterm.nerdfonts.fa_hourglass_start
			table.insert(status, { Foreground = { Color = "#999999" } })
			table.insert(status, { Text = icon .. " -.- " })
		end
	end

	window:set_right_status(wezterm.format(status))
end

return function(config)
	if not is_windows then
		wezterm.on("update-right-status", update_right_status)
	end
end
