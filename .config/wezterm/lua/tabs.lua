local is_windows = package.config:sub(0, 1) == "\\"
local wezterm = require("wezterm")

-- Initialize GLOBAL.cols with a safe default
wezterm.GLOBAL.cols = wezterm.GLOBAL.cols or 100

function get_max_cols(window)
	local tab = window:active_tab()
	if not tab then
		return wezterm.GLOBAL.cols or 100
	end
	local cols = tab:get_size().cols
	return cols
end

-- Cache for padding strings to avoid repeated string.rep calls
local padding_cache = {}

local function get_padding(length)
	if length <= 0 then
		return ""
	end
	if not padding_cache[length] then
		padding_cache[length] = string.rep(" ", length)
	end
	return padding_cache[length]
end

local function format_tab_title(tab, tabs, panes, config, hover, max_width)
	local title = tab.active_pane.title
	local full_title = "[" .. tab.tab_index + 1 .. "] " .. title
	
	-- Safely get cols with fallback to max_width
	local available_cols = wezterm.GLOBAL.cols or max_width or 100
	local num_tabs = #tabs > 0 and #tabs or 1
	
	local pad_length = math.floor((available_cols / num_tabs - #full_title) / 2)
	if pad_length * 2 + #full_title > max_width then
		pad_length = math.floor((max_width - #full_title) / 2)
	end
	
	local padding = get_padding(math.max(0, pad_length))
	return padding .. full_title .. padding
end

return function(config)
	config.tab_bar_at_bottom = true
	config.use_fancy_tab_bar = false
	config.hide_tab_bar_if_only_one_tab = false
	config.show_new_tab_button_in_tab_bar = false
	config.tab_max_width = 999

	local status_bar_offset_cols = 44
	if is_windows then
		status_bar_offset_cols = 0
	end

	wezterm.on("window-config-reloaded", function(window)
		wezterm.GLOBAL.cols = get_max_cols(window) - status_bar_offset_cols
	end)

	wezterm.on("window-resized", function(window, pane)
		wezterm.GLOBAL.cols = get_max_cols(window) - status_bar_offset_cols
	end)

	wezterm.on("format-tab-title", format_tab_title)
end
