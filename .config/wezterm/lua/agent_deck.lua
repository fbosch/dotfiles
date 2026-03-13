local wezterm = require("wezterm")

local M = {}

local agent_deck
local initialized = false
local pane_states = {}
local fallback_state_ttl_ms = 30000

local nf = wezterm.nerdfonts or {}
local theme = require("lua.theme")

local fallback_icons = {
	working = nf.fa_circle or "●",
	waiting = nf.fa_adjust or "◔",
	idle = nf.fa_circle_o or "○",
	inactive = nf.cod_circle_outline or "◌",
}

local fallback_colors = {
	working = theme.agent.working,
	waiting = theme.agent.waiting,
	idle = theme.agent.idle,
	inactive = theme.agent.inactive,
}

local function get_last_lines(text, count)
	if not text or text == "" then
		return ""
	end

	local lines = {}
	for line in text:gmatch("[^\n]+") do
		table.insert(lines, line)
	end

	local start_index = math.max(1, #lines - count + 1)
	local result = {}
	for i = start_index, #lines do
		table.insert(result, lines[i])
	end

	return table.concat(result, "\n"):lower()
end

local function detect_fallback_state(pane, previous_state)
	local success, text = pcall(function()
		return pane:get_lines_as_text(120)
	end)
	if success == false or text == nil or text == "" then
		return nil
	end

	local recent = get_last_lines(text, 80)
	if recent == "" then
		return nil
	end

	local looks_like_opencode = recent:find("opencode", 1, true)
		or recent:find("type your own answer", 1, true)
		or recent:find("enter confirm", 1, true)
		or recent:find("esc dismiss", 1, true)
		or (previous_state and previous_state.agent_type == "opencode")

	if looks_like_opencode == nil then
		return nil
	end

	local waiting = recent:find("type your own answer", 1, true)
		or recent:find("yes, allow once", 1, true)
		or recent:find("yes, allow always", 1, true)
		or recent:find("enter confirm", 1, true)
		or recent:find("(y/n)", 1, true)
	if waiting then
		return { agent_type = "opencode", status = "waiting" }
	end

	local working = recent:find("esc to interrupt", 1, true)
		or recent:find("thinking", 1, true)
		or recent:find("running commands", 1, true)
		or recent:find("making edits", 1, true)
	if working then
		return { agent_type = "opencode", status = "working" }
	end

	if recent:find("\n>%s") or recent:find("\n>$") then
		return { agent_type = "opencode", status = "idle" }
	end

	return { agent_type = "opencode", status = "idle" }
end

function M.apply(config)
	if initialized then
		return agent_deck
	end

	local success, plugin = pcall(wezterm.plugin.require, "https://github.com/Eric162/wezterm-agent-deck")
	if success == false then
		wezterm.log_warn("[wezterm] failed to load agent deck plugin: " .. tostring(plugin))
		initialized = true
		return nil
	end

	agent_deck = plugin
	agent_deck.apply_to_config(config, {
		update_interval = 1000,
		colors = {
			working = fallback_colors.working,
			waiting = fallback_colors.waiting,
			idle = fallback_colors.idle,
			inactive = fallback_colors.inactive,
		},
		icons = {
			style = "nerd",
			nerd = {
				working = nf.fa_circle or "●",
				waiting = nf.fa_adjust or "◔",
				idle = nf.fa_circle_o or "○",
				inactive = nf.cod_circle_outline or "◌",
			},
		},
		tab_title = { enabled = false },
		right_status = { enabled = false },
		notifications = {
			enabled = true,
			on_waiting = true,
		},
	})

	initialized = true
	return agent_deck
end

function M.get()
	return agent_deck
end

function M.update_pane(pane)
	local now = os.time() * 1000
	local pane_id = pane:pane_id()
	local previous_state = pane_states[pane_id]

	if agent_deck then
		agent_deck.update_pane(pane)
	end

	local state = agent_deck and agent_deck.get_agent_state(pane_id) or nil
	if state == nil then
		state = detect_fallback_state(pane, previous_state)
	end

	if state then
		state.last_seen_ms = now
		pane_states[pane_id] = state
		return state
	end

	if previous_state and previous_state.agent_type == "opencode" then
		if (now - (previous_state.last_seen_ms or now)) <= fallback_state_ttl_ms then
			previous_state.status = "idle"
			pane_states[pane_id] = previous_state
			return previous_state
		end
	end

	pane_states[pane_id] = nil
	return nil
end

function M.get_agent_state(pane_id)
	if agent_deck then
		local state = agent_deck.get_agent_state(pane_id)
		if state then
			return state
		end
	end

	return pane_states[pane_id]
end

function M.get_status_icon(status)
	if agent_deck then
		return agent_deck.get_status_icon(status)
	end

	return fallback_icons[status] or fallback_icons.inactive
end

function M.count_waiting()
	if agent_deck then
		local counts = agent_deck.count_agents_by_status()
		local waiting = counts and counts.waiting or 0
		if waiting > 0 then
			return waiting
		end
	end

	local waiting = 0
	for _, state in pairs(pane_states) do
		if state and state.status == "waiting" then
			waiting = waiting + 1
		end
	end

	return waiting
end

function M.get_status_color(status)
	if agent_deck then
		return agent_deck.get_status_color(status)
	end

	return fallback_colors[status] or fallback_colors.inactive
end

return M
