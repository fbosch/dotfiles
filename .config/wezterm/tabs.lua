local is_windows = package.config:sub(0, 1) == "\\"
local wezterm = require("wezterm")
local agent_deck = require("agent")
local herdr = require("agent.herdr")
local theme = require("theme")

local window_cols = wezterm.GLOBAL.window_cols or {}
wezterm.GLOBAL.window_cols = window_cols
local right_status_cols = wezterm.GLOBAL.right_status_cols or {}
wezterm.GLOBAL.right_status_cols = right_status_cols

local function get_window_key(window)
	local ok, window_id = pcall(function()
		return window:window_id()
	end)
	if ok and window_id ~= nil then
		return tostring(window_id)
	end
	return "default"
end

local function get_tab_window_key(tab)
	if tab and tab.window_id ~= nil then
		return tostring(tab.window_id)
	end
	return "default"
end

local function get_max_cols(window)
	local tab = window:active_tab()
	if not tab then
		return 100
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

local function get_display_title(title)
	if title == "herdr" then
		return "", true
	end

	local cwd = title:match("^herdr%s+(.+)$")
	if cwd then
		return cwd, true
	end

	return title, false
end

local function format_tab_title(tab, tabs, panes, config, hover, max_width)
	if #tabs == 1 then
		return { { Text = "" } }
	end

	local title, is_herdr_tab = get_display_title(tab.active_pane.title)
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

			if agent_deck.should_render_state(pane_state) then
				table.insert(icon_items, {
					icon = agent_deck.get_status_icon(pane_state.status),
					color = agent_deck.get_status_color(pane_state.status),
				})
				icon_count = icon_count + 1
			end
		end
	end

	if is_herdr_tab then
		local summary = herdr.get_summary()
		for _, state in ipairs({
			{ status = "working", count = summary.working },
			{ status = "waiting", count = summary.blocked },
			{ status = "idle", count = summary.idle },
			{ status = "inactive", count = summary.inactive },
		}) do
			if state.count > 0 then
				table.insert(icon_items, {
					icon = agent_deck.get_status_icon(state.status),
					count = state.count,
					color = agent_deck.get_status_color(state.status),
				})
				icon_count = icon_count + 2 + #tostring(state.count)
			end
		end
	end

	local base_title = "[" .. tab.tab_index + 1 .. "] " .. title
	local full_title_length = #base_title + icon_count + (icon_count > 0 and 1 or 0)

	local window_key = get_tab_window_key(tab)
	local status_bar_offset_cols = is_windows and 0 or right_status_cols[window_key] or 0
	local available_cols = math.max(1, (window_cols[window_key] or max_width or 100) - status_bar_offset_cols)
	local num_tabs = #tabs > 0 and #tabs or 1

	local pad_length = math.floor((available_cols / num_tabs - full_title_length) / 2)
	if pad_length * 2 + full_title_length > max_width then
		pad_length = math.floor((max_width - full_title_length) / 2)
	end

	local padding = get_padding(math.max(0, pad_length))
	local result = {
		{ Text = padding .. "[" .. tab.tab_index + 1 .. "] " },
	}

	for index, item in ipairs(icon_items) do
		table.insert(result, { Foreground = { Color = item.color } })
		local text = item.icon .. (item.count and " " .. item.count or "")
		if item.count and icon_items[index + 1] and icon_items[index + 1].count then
			text = text .. " "
		end
		table.insert(result, { Text = text })
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
	config.tab_max_width = 40

	wezterm.on("window-config-reloaded", function(window)
		window_cols[get_window_key(window)] = get_max_cols(window)
	end)

	wezterm.on("window-resized", function(window, pane)
		window_cols[get_window_key(window)] = get_max_cols(window)
	end)

	wezterm.on("format-tab-title", format_tab_title)
end
