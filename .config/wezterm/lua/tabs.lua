local is_windows = package.config:sub(0, 1) == "\\"
local wezterm = require("wezterm")
local agent_deck = require("lua.agent_deck")
local theme = require("lua.theme")

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

local function get_tab_title_color(tab, wezterm_config, hover)
	local tab_colors = wezterm_config and wezterm_config.colors and wezterm_config.colors.tab_bar
	if tab_colors == nil then
		return tab.is_active and theme.tab_bar.active_fg or theme.tab_bar.inactive_fg
	end

	if tab.is_active and tab_colors.active_tab and tab_colors.active_tab.fg_color then
		return tab_colors.active_tab.fg_color
	end

	if hover and tab_colors.inactive_tab_hover and tab_colors.inactive_tab_hover.fg_color then
		return tab_colors.inactive_tab_hover.fg_color
	end

	if tab_colors.inactive_tab and tab_colors.inactive_tab.fg_color then
		return tab_colors.inactive_tab.fg_color
	end

	return tab.is_active and theme.tab_bar.active_fg or theme.tab_bar.inactive_fg
end

local function format_tab_title(tab, tabs, panes, config, hover, max_width)
	local title = tab.active_pane.title
	local icon_items = {}
	local icon_count = 0

	if agent_deck then
		for _, pane_info in ipairs(tab.panes or {}) do
			local pane_state
			local ok, mux_pane = pcall(wezterm.mux.get_pane, pane_info.pane_id)
			if ok and mux_pane then
				pane_state = agent_deck.update_pane(mux_pane)
			end

			if pane_state == nil then
				pane_state = agent_deck.get_agent_state(pane_info.pane_id)
			end

			if pane_state then
				table.insert(icon_items, {
					icon = agent_deck.get_status_icon(pane_state.status),
					color = agent_deck.get_status_color(pane_state.status),
				})
				icon_count = icon_count + 1
			end
		end
	end

	local base_title = "[" .. tab.tab_index + 1 .. "] " .. title
	local full_title_length = #base_title + icon_count + (icon_count > 0 and 1 or 0)
	
	-- Safely get cols with fallback to max_width
	local available_cols = wezterm.GLOBAL.cols or max_width or 100
	local num_tabs = #tabs > 0 and #tabs or 1
	
	local pad_length = math.floor((available_cols / num_tabs - full_title_length) / 2)
	if pad_length * 2 + full_title_length > max_width then
		pad_length = math.floor((max_width - full_title_length) / 2)
	end
	
	local padding = get_padding(math.max(0, pad_length))
	local result = {
		{ Text = padding .. "[" .. tab.tab_index + 1 .. "] " },
	}

	for _, item in ipairs(icon_items) do
		table.insert(result, { Foreground = { Color = item.color } })
		table.insert(result, { Text = item.icon })
	end

	if #icon_items > 0 then
		table.insert(result, { Foreground = { Color = get_tab_title_color(tab, config, hover) } })
		table.insert(result, { Text = " " })
	end

	table.insert(result, { Text = title .. padding })

	return result
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
