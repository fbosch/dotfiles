local wezterm = require("wezterm")

local M = {}

local agent_deck
local initialized = false
local pane_states = {}

local nf = wezterm.nerdfonts or {}
local theme = require("lua.theme")

local detection_cache_ttl_ms = 5000
local overlay_state_ttl_ms = 8000

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

local agent_patterns = {
	"opencode",
	"@opencode-ai/",
	"/.opencode/bin/opencode",
	"opencode-darwin",
	"opencode-linux",
	"opencode-win",
}

local waiting_patterns = {
	"type your own answer",
	"yes, allow once",
	"yes, allow always",
	"allow once",
	"allow always",
	"enter confirm",
	"esc dismiss",
	"do you trust",
	"run this command",
	"(y/n)",
	"[y/n]",
}

local working_patterns = {
	"esc interrupt",
	"thinking",
	"running commands",
	"making edits",
	"searching the codebase",
	"searching the web",
}

local opencode_screen_markers = {
	"type your own answer",
	"enter confirm",
	"esc dismiss",
}

local detection_cache = {}

local function now_ms()
	return os.time() * 1000
end

local function strip_ansi(text)
	if text == nil then
		return ""
	end

	return text:gsub("\27%[[%d;]*[A-Za-z]", "")
end

local function matches_any_pattern(text, patterns)
	if text == nil or text == "" then
		return false
	end

	local lower = text:lower()
	for _, pattern in ipairs(patterns) do
		if lower:find(pattern, 1, true) then
			return true
		end
	end

	return false
end

local function process_is_opencode(process_info)
	if process_info == nil then
		return false
	end

	if matches_any_pattern(process_info.name or "", agent_patterns) then
		return true
	end

	if matches_any_pattern(process_info.executable or "", agent_patterns) then
		return true
	end

	local argv = process_info.argv or {}
	if #argv > 0 and matches_any_pattern(table.concat(argv, " "), agent_patterns) then
		return true
	end

	local children = process_info.children or {}
	for _, child in pairs(children) do
		if process_is_opencode(child) then
			return true
		end
	end

	return false
end

local function pane_has_opencode_process(pane)
	local pane_id = pane:pane_id()
	local cache = detection_cache[pane_id]
	local now = now_ms()

	if cache and (now - cache.checked_at_ms) < detection_cache_ttl_ms then
		return cache.is_opencode
	end

	local ok, process_info = pcall(function()
		return pane:get_foreground_process_info()
	end)

	local is_opencode = false
	if ok and process_info then
		is_opencode = process_is_opencode(process_info)
	end

	if is_opencode == false then
		local title_ok, title = pcall(function()
			return pane:get_title()
		end)
		if title_ok and title then
			is_opencode = matches_any_pattern(title, agent_patterns)
		end
	end

	detection_cache[pane_id] = {
		is_opencode = is_opencode,
		checked_at_ms = now,
	}

	return is_opencode
end

local function get_last_lines(text, count)
	if text == nil or text == "" then
		return ""
	end

	local lines = {}
	for line in text:gmatch("[^\n]+") do
		lines[#lines + 1] = line
	end

	if #lines == 0 then
		return ""
	end

	local start_index = math.max(1, #lines - count + 1)
	local result = {}
	for i = start_index, #lines do
		result[#result + 1] = lines[i]
	end

	return strip_ansi(table.concat(result, "\n")):lower()
end

local function detect_status_from_text(recent_120)
	if recent_120 == "" then
		return nil
	end

	local idle_recent = get_last_lines(recent_120, 8)
	if idle_recent:find("\n>%s") or idle_recent:find("\n>$") then
		return "idle"
	end

	local waiting_recent = get_last_lines(recent_120, 30)
	if matches_any_pattern(waiting_recent, waiting_patterns) then
		return "waiting"
	end

	local working_recent = get_last_lines(recent_120, 10)
	if matches_any_pattern(working_recent, working_patterns) then
		return "working"
	end

	return nil
end

local function detect_overlay_state(pane, previous_state, has_opencode_process)
	local ok, text = pcall(function()
		return pane:get_lines_as_text(120)
	end)
	if ok == false or text == nil or text == "" then
		return nil
	end

	local recent_120 = get_last_lines(text, 120)
	if recent_120 == "" then
		return nil
	end

	local looks_like_opencode = has_opencode_process
	if looks_like_opencode == false and matches_any_pattern(recent_120, opencode_screen_markers) then
		looks_like_opencode = true
	end
	if looks_like_opencode == false and previous_state and previous_state.agent_type == "opencode" then
		looks_like_opencode = true
	end

	if looks_like_opencode == false then
		return nil
	end

	local status = detect_status_from_text(recent_120)
	if status == nil then
		status = "idle"
	end

	return {
		agent_type = "opencode",
		status = status,
	}
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
	local now = now_ms()
	local pane_id = pane:pane_id()
	local previous_state = pane_states[pane_id]
	local has_opencode_process = pane_has_opencode_process(pane)

	if agent_deck then
		agent_deck.update_pane(pane)
	end

	local state = agent_deck and agent_deck.get_agent_state(pane_id) or nil
	if state == nil then
		state = detect_overlay_state(pane, previous_state, has_opencode_process)
	end

	if state then
		state.last_seen_ms = now
		pane_states[pane_id] = state
		return state
	end

	if previous_state and previous_state.agent_type == "opencode" then
		if (now - (previous_state.last_seen_ms or now)) <= overlay_state_ttl_ms then
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
