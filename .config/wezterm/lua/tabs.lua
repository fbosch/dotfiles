local wezterm = require("wezterm")

function get_max_cols(window)
	local tab = window:active_tab()
	local cols = tab:get_size().cols
	return cols
end

local function format_tab_title(tab, tabs, panes, config, hover, max_width)
	local title = tab.active_pane.title
	local full_title = "[" .. tab.tab_index + 1 .. "] " .. title
	local pad_length = math.floor((wezterm.GLOBAL.cols / #tabs - #full_title) / 2)
	if pad_length * 2 + #full_title > max_width then
		pad_length = math.floor((max_width - #full_title) / 2)
	end
	return string.rep(" ", pad_length) .. full_title .. string.rep(" ", pad_length)
end

return function(config)
	config.tab_bar_at_bottom = true
	config.use_fancy_tab_bar = false
	config.hide_tab_bar_if_only_one_tab = false
	config.show_new_tab_button_in_tab_bar = false
	config.tab_max_width = 999

	local status_bar_offset_cols = 44

	wezterm.on("window-config-reloaded", function(window)
		wezterm.GLOBAL.cols = get_max_cols(window) - status_bar_offset_cols
	end)

	wezterm.on("window-resized", function(window, pane)
		wezterm.GLOBAL.cols = get_max_cols(window) - status_bar_offset_cols
	end)

	wezterm.on("format-tab-title", format_tab_title)
end
