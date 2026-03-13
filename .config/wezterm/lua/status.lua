local is_windows = package.config:sub(0, 1) == "\\"
local wezterm = require("wezterm")
local agent_deck = require("lua.agent")
local theme = require("lua.theme")

-- Pre-allocate color tables to reduce allocations
local color_gray = { Color = theme.base.fg_muted }
local color_separator = { Color = theme.base.separator }
local color_white = { Color = theme.base.fg }
local color_waiting = { Color = theme.agent.waiting }

-- Reusable status table structure
local status = {}

local function update_right_status(window)
	local waiting_count = 0
	local init_notice = agent_deck.consume_init_notice and agent_deck.consume_init_notice() or nil
	if init_notice then
		window:toast_notification("WezTerm", init_notice, nil, 4000)
	end

	if agent_deck then
		for _, tab in ipairs(window:mux_window():tabs()) do
			for _, pane in ipairs(tab:panes()) do
				agent_deck.update_pane(pane)
			end
		end

		waiting_count = agent_deck.count_waiting()
	end

	local date = wezterm.strftime("(%Y-%m-%d) %a %b %-d ")
	local time = wezterm.strftime("%H:%M")
	local week_number = os.date("%V")

	-- Reset and reuse the status table
	status = {
		{ Foreground = color_waiting },
		{ Text = waiting_count > 0 and ("◔ " .. waiting_count .. " ") or "" },
		{ Foreground = color_separator },
		{ Text = waiting_count > 0 and "▏" or "" },
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
