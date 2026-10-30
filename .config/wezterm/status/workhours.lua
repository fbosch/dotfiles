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

local refresh_interval_seconds = 10
local detection_interval_seconds = 60
local cached_date, checked_at, start_time, detection_date, detected_at

local function detect_start(today, now)
	if not (wezterm.target_triple or ""):find("apple", 1, true) then
		return
	end
	if detection_date == today and now - detected_at < detection_interval_seconds then
		return
	end
	detection_date, detected_at = today, now
	local search_path = table.concat({
		"/etc/profiles/per-user/" .. (os.getenv("USER") or "") .. "/bin",
		"/run/current-system/sw/bin",
		"/opt/homebrew/bin",
		"/usr/local/bin",
		"$PATH",
	}, ":")
	-- Log discovery can take seconds; never block the status callback on it.
	-- --no-config skips startup hooks and also needs the user-function path restored.
	wezterm.background_child_process({
		"/bin/sh",
		"-c",
		string.format(
			"PATH=%q; export PATH; exec fish --no-config -c 'set -g fish_function_path \"$__fish_config_dir/functions\" $fish_function_path; first_login_of_the_day --silent' >/dev/null 2>&1",
			search_path
		),
	})
end

local function current_start()
	local today, now = os.date("%y-%m-%d"), os.time()
	if cached_date == today and now - checked_at < refresh_interval_seconds then
		return start_time
	end
	-- A surviving pane must not carry yesterday's start into a new workday.
	cached_date, checked_at, start_time = today, now, nil
	local cache_base = os.getenv("XDG_CACHE_HOME")
	if not cache_base or cache_base == "" then
		cache_base = (os.getenv("HOME") or "") .. "/.cache"
	end
	local file = io.open(cache_base .. "/first_login/" .. today, "r")
	if file then
		local value = file:read("*l")
		file:close()
		if value and value:match("^%d%d?:%d%d:%d%d$") then
			local hour, minute, second = time_utils.parse_time(value)
			local elapsed = time_utils.calculate_hour_difference(value, wezterm.strftime("%H:%M:%S"))
			if hour < 24 and minute < 60 and second < 60 and elapsed >= 0 then
				start_time = value
			end
		end
	end
	if not start_time then
		detect_start(today, now)
	end
	return start_time
end

local function get_display()
	local wday = os.date("*t").wday
	if wday == 1 or wday == 7 then
		return nil
	end

	local hours_worked = time_utils.calculate_hour_difference(current_start(), wezterm.strftime("%H:%M:%S"))
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
