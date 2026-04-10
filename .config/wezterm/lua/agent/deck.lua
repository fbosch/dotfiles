local wezterm = require("wezterm")

local M = {}

local agent_deck
local initialized = false
local pane_states = {}
local init_notice

local nf = wezterm.nerdfonts or {}
local theme = require("lua.theme")
local detection = require("lua.agent.detection")

local detection_cache_ttl_ms = 5000
local overlay_state_ttl_ms = 5000
local pane_refresh_cooldown_ms_active = 250
local pane_refresh_cooldown_ms_idle = 1000
local attention_notification_timeout_ms = 4000

local target_triple = wezterm.target_triple or ""
local is_linux = target_triple:find("linux") ~= nil
local is_macos = target_triple:find("apple%-darwin") ~= nil

local allowed_agents = {
	opencode = true,
	claude = true,
	gemini = true,
	codex = true,
	aider = true,
}

local allowed_statuses = {
	working = true,
	waiting = true,
	idle = true,
	inactive = true,
}

local fallback_icons = {
	working = nf.fa_circle or "●",
	waiting = nf.fa_circle_half_stroke or nf.fa_adjust or "◔",
	idle = nf.fa_circle_o or "○",
	inactive = nf.cod_circle or "◌",
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

local detection_cache = {}
local pane_refresh_timestamps = {}

local function get_agent_display_name(agent_type)
	local names = {
		opencode = "OpenCode",
		claude = "Claude",
		gemini = "Gemini",
		codex = "Codex",
		aider = "Aider",
	}

	return names[agent_type] or (agent_type or "Agent")
end

local function send_attention_toast(pane, title, message)
	local tab_ok, tab = pcall(function()
		return pane:tab()
	end)
	if tab_ok == false or tab == nil then
		return false
	end

	local mux_ok, mux_window = pcall(function()
		return tab:window()
	end)
	if mux_ok == false or mux_window == nil then
		return false
	end

	local gui_ok, gui_window = pcall(function()
		return mux_window:gui_window()
	end)
	if gui_ok == false or gui_window == nil then
		return false
	end

	gui_window:toast_notification(title, message, nil, attention_notification_timeout_ms)
	return true
end

local function try_background_child_process(argv)
	local ok = pcall(function()
		wezterm.background_child_process(argv)
	end)

	return ok
end

local function notify_attention(pane, agent_type)
	local subtitle = string.format("%s - Attention Needed", get_agent_display_name(agent_type))
	local message = "Needs your input"

	if is_linux then
		local ok = try_background_child_process({
			"notify-send",
			"--urgency=normal",
			"--app-name=WezTerm",
			"--expire-time=" .. tostring(attention_notification_timeout_ms),
			subtitle,
			message,
		})
		if ok then
			return
		end
	end

	if is_macos then
		local notifier_group = "wezterm-agent-deck-" .. tostring(agent_type or "unknown")
		local terminal_notifier_paths = {
			"terminal-notifier",
			"/opt/homebrew/bin/terminal-notifier",
			"/usr/local/bin/terminal-notifier",
		}

		for _, notifier_path in ipairs(terminal_notifier_paths) do
			local ok = try_background_child_process({
				notifier_path,
				"-title",
				"WezTerm Agent Deck",
				"-subtitle",
				subtitle,
				"-message",
				message,
				"-group",
				notifier_group,
				"-activate",
				"com.github.wez.wezterm",
			})
			if ok then
				return
			end
		end

		local script =
			string.format("display notification %q with title %q subtitle %q", message, "WezTerm Agent Deck", subtitle)
		if try_background_child_process({ "osascript", "-e", script }) then
			return
		end
	end

	send_attention_toast(pane, subtitle, message)
end

local function on_attention_needed(_, pane, agent_type, reason)
	if reason ~= "waiting_for_input" then
		return
	end

	notify_attention(pane, agent_type)
end

local function now_ms()
	local ok, now = pcall(function()
		return wezterm.time.now()
	end)

	if ok and now then
		local as_number = tonumber(now:format("%s.%f"))
		if as_number then
			return math.floor(as_number * 1000)
		end
	end

	return os.time() * 1000
end

local function process_is_opencode(process_info)
	if process_info == nil then
		return false
	end

	if detection.matches_any_pattern(process_info.name or "", agent_patterns) then
		return true
	end

	if detection.matches_any_pattern(process_info.executable or "", agent_patterns) then
		return true
	end

	local argv = process_info.argv or {}
	if #argv > 0 and detection.matches_any_pattern(table.concat(argv, " "), agent_patterns) then
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
			is_opencode = detection.matches_any_pattern(title, agent_patterns)
		end
	end

	detection_cache[pane_id] = {
		is_opencode = is_opencode,
		checked_at_ms = now,
	}

	return is_opencode
end

local function detect_overlay_state(pane, has_opencode_process)
	local ok, text = pcall(function()
		return pane:get_lines_as_text(120)
	end)
	if ok == false or text == nil or text == "" then
		return nil
	end

	return detection.detect_overlay_state_from_text({
		text = text,
		has_opencode_process = has_opencode_process,
	})
end

local function normalize_state(state, source)
	if state == nil then
		return nil
	end

	if type(state) ~= "table" then
		return nil
	end

	if type(state.agent_type) ~= "string" then
		return nil
	end

	if type(state.status) ~= "string" then
		return nil
	end

	if allowed_statuses[state.status] == nil then
		return nil
	end

	if source and state.source == nil then
		state.source = source
	end

	return state
end

local function get_refresh_cooldown_ms(state)
	if state and (state.status == "working" or state.status == "waiting") then
		return pane_refresh_cooldown_ms_active
	end

	return pane_refresh_cooldown_ms_idle
end

function M.should_render_state(state)
	if state == nil then
		return false
	end

	if type(state) ~= "table" then
		return false
	end

	if type(state.agent_type) ~= "string" then
		return false
	end

	if allowed_agents[state.agent_type] == nil then
		return false
	end

	if type(state.status) ~= "string" then
		return false
	end

	if allowed_statuses[state.status] == nil then
		return false
	end

	return true
end

function M.apply(config)
	if initialized then
		return agent_deck
	end

	local success, plugin = pcall(wezterm.plugin.require, "https://github.com/Eric162/wezterm-agent-deck")
	if success == false then
		init_notice = "Agent deck plugin unavailable; using fallback detection"
		wezterm.log_warn("[wezterm] failed to load agent deck plugin: " .. tostring(plugin))
		initialized = true
		return nil
	end

	agent_deck = plugin
	local plugin_config = {
		update_interval = 1000,
		colors = {
			working = fallback_colors.working,
			waiting = fallback_colors.waiting,
			idle = fallback_colors.idle,
			inactive = fallback_colors.inactive,
		},
		icons = {
			style = "nerd",
			nerd = fallback_icons,
		},
		tab_title = { enabled = false },
		right_status = { enabled = false },
		notifications = {
			enabled = false,
		},
	}

	local ok_apply, apply_err = pcall(agent_deck.apply_to_config, config, plugin_config)
	if ok_apply == false then
		agent_deck = nil
		init_notice = "Agent deck failed to initialize; using fallback detection"
		wezterm.log_warn("[wezterm] agent deck apply_to_config failed: " .. tostring(apply_err))
		initialized = true
		return nil
	end

	init_notice = nil
	wezterm.on("agent_deck.attention_needed", on_attention_needed)
	initialized = true
	return agent_deck
end

function M.consume_init_notice()
	local notice = init_notice
	init_notice = nil
	return notice
end

function M.get()
	return agent_deck
end

function M.update_pane(pane)
	local now = now_ms()
	local pane_id = pane:pane_id()
	local previous_state = pane_states[pane_id]
	local plugin_state = nil
	local last_refresh_ms = pane_refresh_timestamps[pane_id] or 0
	local refresh_cooldown_ms = get_refresh_cooldown_ms(previous_state)

	if (now - last_refresh_ms) < refresh_cooldown_ms then
		return normalize_state(previous_state)
	end

	pane_refresh_timestamps[pane_id] = now

	if agent_deck then
		agent_deck.update_pane(pane)
		plugin_state = normalize_state(agent_deck.get_agent_state(pane_id), "plugin")
	end

	if plugin_state then
		plugin_state.last_seen_ms = now
		pane_states[pane_id] = plugin_state
		return plugin_state
	end

	local has_opencode_process = pane_has_opencode_process(pane)
	local overlay_state = normalize_state(detect_overlay_state(pane, has_opencode_process), "overlay")

	if overlay_state then
		overlay_state.last_seen_ms = now
		pane_states[pane_id] = overlay_state
		return overlay_state
	end

	if previous_state and previous_state.source == "overlay" and previous_state.confidence == "confirmed" then
		if (now - (previous_state.last_seen_ms or now)) <= overlay_state_ttl_ms then
			pane_states[pane_id] = previous_state
			return previous_state
		end
	end

	pane_states[pane_id] = nil
	pane_refresh_timestamps[pane_id] = now
	return nil
end

function M.get_agent_state(pane_id)
	if agent_deck then
		local state = normalize_state(agent_deck.get_agent_state(pane_id), "plugin")
		if state then
			return state
		end
	end

	return normalize_state(pane_states[pane_id])
end

function M.get_status_icon(status)
	if agent_deck then
		return agent_deck.get_status_icon(status)
	end

	return fallback_icons[status] or fallback_icons.inactive
end

function M.count_waiting()
	local waiting = 0
	for _, state in pairs(pane_states) do
		if M.should_render_state(state) and state.status == "waiting" then
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
