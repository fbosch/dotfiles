local wezterm = require("wezterm")
local palette = require("theme")
local time_utils = require("utils.time")

local colors = {
	start = { Color = palette.semantic.subtle },
	half = { Color = palette.ansi.yellow },
	end_time = { Color = palette.semantic.attention },
	good = { Color = palette.ansi.green },
	over = { Color = palette.semantic.critical },
}

local function get_display(window)
	local wday = os.date("*t").wday
	if wday == 1 or wday == 7 then
		return nil
	end

	local mux_window = window:mux_window()
	if mux_window == nil then
		return wezterm.nerdfonts.fa_hourglass_start, "-.-", colors.start
	end

	local active_pane = mux_window:active_pane()
	if active_pane == nil then
		return wezterm.nerdfonts.fa_hourglass_start, "-.-", colors.start
	end

	local user_vars = active_pane:get_user_vars() or {}
	local hours_worked = time_utils.calculate_hour_difference(user_vars.first_login, wezterm.strftime("%H:%M:%S"))
	if hours_worked == nil or hours_worked <= 0 or hours_worked >= 10 then
		return wezterm.nerdfonts.fa_hourglass_start, "-.-", colors.start
	end

	local icon = wezterm.nerdfonts.fa_hourglass_start
	local color = colors.start
	if hours_worked > 8 then
		icon = wezterm.nerdfonts.fa_hourglass_o
		color = colors.over
	elseif hours_worked >= 7 then
		icon = wezterm.nerdfonts.fa_hourglass_o
		color = colors.good
	elseif hours_worked >= 5 then
		icon = wezterm.nerdfonts.fa_hourglass_end
		color = colors.end_time
	elseif hours_worked >= 2 then
		icon = wezterm.nerdfonts.fa_hourglass_half
		color = colors.half
	end

	local hours_text = string.format("%.1f", hours_worked):gsub("%.0$", "")
	return icon, hours_text, color
end

return { get_display = get_display }
