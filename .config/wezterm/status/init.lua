local is_windows = package.config:sub(0, 1) == "\\"
local wezterm = require("wezterm")
local agent_deck = require("agent")
local palette = require("theme")
local codex = require("status.codex")
local workhours = require("status.workhours")

local color_gray = { Color = palette.semantic.muted }
local color_separator = { Color = palette.semantic.separator }
local color_white = { Color = palette.foreground }
local color_waiting = { Color = palette.semantic.attention }
local right_status_cols = wezterm.GLOBAL and wezterm.GLOBAL.right_status_cols or {}

if wezterm.GLOBAL then
	wezterm.GLOBAL.right_status_cols = right_status_cols
end

local status = {}

local function get_window_key(window)
	local ok, window_id = pcall(function()
		return window:window_id()
	end)
	if ok and window_id ~= nil then
		return tostring(window_id)
	end
	return "default"
end

local function text_width(text)
	if wezterm.column_width then
		return wezterm.column_width(text)
	end
	return #text
end

local function status_width(items)
	local width = 0
	for _, item in ipairs(items) do
		if item.Text then
			width = width + text_width(item.Text)
		end
	end
	return width
end

local function update_right_status(window)
	local waiting_count = 0
	local init_notice = agent_deck.consume_init_notice and agent_deck.consume_init_notice() or nil
	if init_notice then
		window:toast_notification("Agent Deck", init_notice, nil, 2500)
	end

	if agent_deck then
		local mux_window = window:mux_window()
		if mux_window then
			for _, tab in ipairs(mux_window:tabs()) do
				for _, pane in ipairs(tab:panes()) do
					agent_deck.update_pane(pane)
				end
			end
		end

		waiting_count = agent_deck.count_waiting()
	end

	local date = wezterm.strftime("(%Y-%m-%d) %a %b %-d ")
	local time = wezterm.strftime("%H:%M")
	local week_number = os.date("%V")
	local workhours_icon, workhours_text, workhours_color = workhours.get_display(window)

	status = {
		{ Foreground = color_waiting },
		{ Text = waiting_count > 0 and ("◔ " .. waiting_count .. " ") or "" },
		{ Foreground = color_separator },
		{ Text = waiting_count > 0 and "▏" or "" },
	}

	codex.append(status)

	table.insert(status, { Foreground = color_gray })
	table.insert(status, { Text = date })
	table.insert(status, { Foreground = color_separator })
	table.insert(status, { Text = "▏" })
	table.insert(status, { Foreground = color_gray })
	table.insert(status, { Text = wezterm.nerdfonts.cod_calendar .. " " .. tonumber(week_number) })
	table.insert(status, { Foreground = color_separator })
	table.insert(status, { Text = " ▏" })
	table.insert(status, { Foreground = color_white })
	table.insert(status, { Text = time })

	if workhours_icon and workhours_text and workhours_color then
		table.insert(status, { Foreground = color_separator })
		table.insert(status, { Text = "▕" })
		table.insert(status, { Text = " " })
		table.insert(status, { Foreground = workhours_color })
		table.insert(status, { Text = workhours_icon .. " " .. workhours_text .. " " })
	end

	local window_key = get_window_key(window)
	right_status_cols[window_key] = status_width(status)
	window:set_right_status(wezterm.format(status))
end

return function()
	if not is_windows then
		wezterm.on("window-config-reloaded", update_right_status)
		wezterm.on("update-right-status", update_right_status)
		wezterm.on("user-var-changed", function(window, _, name)
			if codex.handle_user_var(name) then
				update_right_status(window)
			end
		end)
	end
end
