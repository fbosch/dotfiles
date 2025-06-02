local is_windows = package.config:sub(0, 1) == "\\"
local wezterm = require("wezterm")

local function update_right_status(window, pane)
	local date = wezterm.strftime("(%Y-%m-%d) %a %b %-d ")
	local time = wezterm.strftime("%H:%M")
	local week_number = os.date("%V")

	local status = {
		{ Foreground = { Color = "#7c7c7c" } },
		{ Text = date },
		{ Foreground = { Color = "#515151" } },
		{ Text = "▏" },
		{ Foreground = { Color = "#7c7c7c" } },
		{ Text = wezterm.nerdfonts.cod_calendar .. " " .. tonumber(week_number) },
		{ Foreground = { Color = "#515151" } },
		{ Text = " ▏" },
		{ Foreground = { Color = "#bbbbbb" } },
		{ Text = time },
		{ Foreground = { Color = "#515151" } },
		{ Text = "▕" },
	}

	local wday = os.date("*t").wday
	if wday ~= 1 and wday ~= 7 then
		local first_login = pane:get_user_vars().first_login
		local calculated_hours =
			require("lua.utils.time").calculate_hour_difference(first_login, wezterm.strftime("%H:%M:%S"))
		local hours_worked = calculated_hours or 0
		local icon = ""
		table.insert(status, { Text = " " })

		if hours_worked > 0 and hours_worked < 10 then
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
		else
			local hours_string = "-.-"
			icon = wezterm.nerdfonts.fa_hourglass_start
			table.insert(status, { Foreground = { Color = "#999999" } })
			table.insert(status, { Text = icon .. " " .. hours_string .. " " })
		end
	end

	window:set_right_status(wezterm.format(status))
end

return function(config)
	if not is_windows then
		wezterm.on("update-right-status", update_right_status)
	end
end
