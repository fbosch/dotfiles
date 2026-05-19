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
local attention_notification_cooldown_ms = 5000
local notification_debug = os.getenv("WEZTERM_AGENT_DECK_NOTIFY_DEBUG") == "1"

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
local session_title_cache = {}
local pane_refresh_timestamps = {}
local attention_notification_timestamps = {}
local now_ms

local function prune_closed_panes()
	if not (wezterm.mux and wezterm.mux.all_windows) then
		return
	end

	local ok, mux_windows = pcall(wezterm.mux.all_windows)
	if not ok or mux_windows == nil then
		return
	end

	local live_panes = {}
	for _, mux_window in ipairs(mux_windows) do
		local tabs_ok, tabs = pcall(function()
			return mux_window:tabs()
		end)
		if tabs_ok and tabs then
			for _, tab in ipairs(tabs) do
				local panes_ok, panes = pcall(function()
					return tab:panes()
				end)
				if panes_ok and panes then
					for _, pane in ipairs(panes) do
						local pane_id_ok, pane_id = pcall(function()
							return pane:pane_id()
						end)
						if pane_id_ok and pane_id ~= nil then
							live_panes[pane_id] = true
						end
					end
				end
			end
		end
	end

	for pane_id in pairs(pane_states) do
		if not live_panes[pane_id] then
			pane_states[pane_id] = nil
			detection_cache[pane_id] = nil
			pane_refresh_timestamps[pane_id] = nil
			attention_notification_timestamps[pane_id] = nil
		end
	end
end

local function log_notification_debug(message)
	if notification_debug then
		wezterm.log_info("[wezterm] agent deck notification: " .. tostring(message))
	end
end

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

local function resolve_gui_window_from_pane(pane)
	local tab_ok, tab = pcall(function()
		return pane:tab()
	end)
	if tab_ok == false or tab == nil then
		return nil, "pane has no tab"
	end

	local mux_ok, mux_window = pcall(function()
		return tab:window()
	end)
	if mux_ok == false or mux_window == nil then
		return nil, "tab has no mux window"
	end

	local gui_ok, gui_window = pcall(function()
		return mux_window:gui_window()
	end)
	if gui_ok == false or gui_window == nil then
		return nil, "mux window has no gui window"
	end

	return gui_window, nil
end

local function resolve_notification_window(window, pane)
	if window ~= nil then
		return window, nil
	end

	return resolve_gui_window_from_pane(pane)
end

local function send_attention_toast(window, pane, title, message)
	local gui_window, err = resolve_notification_window(window, pane)
	if gui_window == nil then
		return false, err
	end

	local ok, toast_err = pcall(function()
		gui_window:toast_notification(title, message, nil, attention_notification_timeout_ms)
	end)
	if ok == false then
		return false, toast_err
	end

	return true, nil
end

local function try_background_child_process(argv)
	local ok, err = pcall(function()
		wezterm.background_child_process(argv)
	end)

	return ok, err
end

local file_exists

local function shell_sql_string(value)
	return "'" .. tostring(value):gsub("'", "''") .. "'"
end

local function trim_string(value)
	if type(value) ~= "string" then
		return nil
	end

	local trimmed = value:match("^%s*(.-)%s*$")
	if trimmed == nil or trimmed == "" then
		return nil
	end

	return trimmed
end

local function get_basename(path)
	local trimmed = trim_string(path)
	if trimmed == nil then
		return nil
	end

	local without_trailing_slash = trimmed:gsub("/+$", "")
	return trim_string(without_trailing_slash:match("([^/]+)$"))
end

local function get_opencode_db_path()
	local home = os.getenv("HOME")
	if home == nil or home == "" then
		return nil
	end

	return home .. "/.local/share/opencode/opencode.db"
end

local function query_opencode_session_title(session_id)
	if type(session_id) ~= "string" or session_id == "" then
		return nil
	end

	local now = now_ms()
	local cache = session_title_cache[session_id]
	if cache and (now - cache.checked_at_ms) < detection_cache_ttl_ms then
		return cache.title
	end

	local db_path = get_opencode_db_path()
	if db_path == nil or file_exists(db_path) == false then
		session_title_cache[session_id] = { title = nil, checked_at_ms = now }
		return nil
	end

	local query = "select coalesce(nullif(title, ''), slug) || char(9) || coalesce(directory, '') from session where id = "
		.. shell_sql_string(session_id)
		.. " limit 1"
	if type(wezterm.run_child_process) ~= "function" then
		session_title_cache[session_id] = { title = nil, checked_at_ms = now }
		return nil
	end

	local ok, success, stdout = pcall(function()
		return wezterm.run_child_process({ "sqlite3", db_path, "-noheader", query })
	end)
	local title = nil
	if ok and success then
		local raw_title, raw_directory = tostring(stdout or ""):match("^([^\t]*)\t(.*)$")
		title = trim_string(raw_title or stdout)
		local directory_name = get_basename(raw_directory)
		if title ~= nil and directory_name ~= nil then
			title = title .. " (" .. directory_name .. ")"
		end
	end

	session_title_cache[session_id] = { title = title, checked_at_ms = now }
	return title
end

file_exists = function(path)
	if type(path) ~= "string" or path == "" then
		return false
	end

	local handle = io.open(path, "r")
	if handle == nil then
		return false
	end

	handle:close()
	return true
end

local function is_attention_reason(reason)
	if reason == nil then
		return true
	end

	local allowed_reasons = {
		waiting_for_input = true,
		waiting = true,
		input_required = true,
		needs_input = true,
	}

	return allowed_reasons[reason] == true
end

local function should_throttle_attention(pane, agent_type)
	local pane_id = pane and pane:pane_id() or "unknown"
	local key = tostring(pane_id) .. ":" .. tostring(agent_type or "unknown")
	local now = now_ms()
	local last_sent_ms = attention_notification_timestamps[key] or 0
	if (now - last_sent_ms) < attention_notification_cooldown_ms then
		return true, key
	end

	attention_notification_timestamps[key] = now
	return false, key
end

local function notify_attention(window, pane, agent_type, reason)
	local subtitle = string.format("%s - Attention Needed", get_agent_display_name(agent_type))
	local message = "Needs your input"
	local throttled, throttle_key = should_throttle_attention(pane, agent_type)
	if throttled then
		log_notification_debug("throttled for key=" .. tostring(throttle_key))
		return
	end

	local toast_ok, toast_err = send_attention_toast(window, pane, subtitle, message)
	if toast_ok then
		log_notification_debug("delivered via wezterm toast")
		return
	end

	log_notification_debug("toast unavailable: " .. tostring(toast_err) .. ", reason=" .. tostring(reason))

	if is_linux then
		local ok = select(1, try_background_child_process({
			"notify-send",
			"--urgency=normal",
			"--app-name=WezTerm",
			"--expire-time=" .. tostring(attention_notification_timeout_ms),
			subtitle,
			message,
		}))
		if ok then
			log_notification_debug("spawned linux notify-send fallback")
			return
		end
		log_notification_debug("linux notify-send fallback failed")
	end

	if is_macos then
		local notifier_group = "wezterm-agent-deck-" .. tostring(agent_type or "unknown")
		local terminal_notifier_paths = {
			"/opt/homebrew/bin/terminal-notifier",
			"/usr/local/bin/terminal-notifier",
			"terminal-notifier",
		}

		for _, notifier_path in ipairs(terminal_notifier_paths) do
			if notifier_path:sub(1, 1) == "/" and file_exists(notifier_path) == false then
				log_notification_debug("macOS terminal-notifier missing: " .. notifier_path)
			else
				local ok, notifier_err = try_background_child_process({
					notifier_path,
					"-title",
					"WezTerm Agent Deck",
					"-subtitle",
					subtitle,
					"-message",
					message,
					"-group",
					notifier_group,
				})
				if ok then
					log_notification_debug("spawned macOS terminal-notifier fallback: " .. notifier_path)
					return
				end
				log_notification_debug(
					"macOS terminal-notifier path failed: " .. notifier_path .. ", err=" .. tostring(notifier_err)
				)
			end
		end

		local script =
			string.format("display notification %q with title %q subtitle %q", message, "WezTerm Agent Deck", subtitle)
		local osascript_paths = {
			"/usr/bin/osascript",
			"osascript",
		}
		for _, osascript_path in ipairs(osascript_paths) do
			if osascript_path:sub(1, 1) == "/" and file_exists(osascript_path) == false then
				log_notification_debug("macOS osascript missing: " .. osascript_path)
			else
				local ok, osascript_err = try_background_child_process({ osascript_path, "-e", script })
				if ok then
					log_notification_debug("spawned macOS osascript fallback: " .. osascript_path)
					return
				end
				log_notification_debug(
					"macOS osascript path failed: " .. osascript_path .. ", err=" .. tostring(osascript_err)
				)
			end
		end
		log_notification_debug("macOS osascript fallback failed")
	end

	log_notification_debug("all notification paths exhausted")
end

local function on_attention_needed(window, pane, agent_type, reason)
	if is_attention_reason(reason) == false then
		log_notification_debug("ignored attention reason=" .. tostring(reason))
		return
	end

	notify_attention(window, pane, agent_type, reason)
end

now_ms = function()
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

local function find_opencode_session_id(process_info)
	if process_info == nil then
		return nil
	end

	local argv = process_info.argv or {}
	for index, arg in ipairs(argv) do
		if type(arg) == "string" then
			local inline_session_id = arg:match("^%-%-session=(.+)$")
			if inline_session_id and inline_session_id ~= "" then
				return inline_session_id
			end

			if arg == "--session" and type(argv[index + 1]) == "string" and argv[index + 1] ~= "" then
				return argv[index + 1]
			end
		end
	end

	local children = process_info.children or {}
	for _, child in pairs(children) do
		local session_id = find_opencode_session_id(child)
		if session_id then
			return session_id
		end
	end

	return nil
end

local function get_opencode_session_id(pane)
	if pane == nil then
		return nil
	end

	local pane_id = pane:pane_id()
	local cache = detection_cache[pane_id]
	if cache and type(cache.session_id) == "string" and cache.session_id ~= "" then
		return cache.session_id
	end

	local ok, process_info = pcall(function()
		return pane:get_foreground_process_info()
	end)
	if ok == false or process_info == nil then
		return nil
	end

	local session_id = find_opencode_session_id(process_info)
	if session_id and cache then
		cache.session_id = session_id
	end

	return session_id
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
	local session_id = nil
	if ok and process_info then
		is_opencode = process_is_opencode(process_info)
		session_id = find_opencode_session_id(process_info)
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
		session_id = session_id,
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

local function get_pane_session_name(pane)
	local session_title = query_opencode_session_title(get_opencode_session_id(pane))
	if session_title ~= nil then
		return session_title
	end

	local ok, title = pcall(function()
		return pane:get_title()
	end)
	if ok == false or type(title) ~= "string" then
		return nil
	end

	local trimmed = title:match("^%s*(.-)%s*$")
	if trimmed == nil or trimmed == "" then
		return nil
	end

	return trimmed
end

local function attach_session_name(state, pane)
	if state == nil or pane == nil then
		return state
	end

	local session_name = get_pane_session_name(pane)
	state.session_name = session_name

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
		return attach_session_name(normalize_state(previous_state), pane)
	end

	pane_refresh_timestamps[pane_id] = now

	if agent_deck then
		agent_deck.update_pane(pane)
		plugin_state = normalize_state(agent_deck.get_agent_state(pane_id), "plugin")
	end

	if plugin_state then
		attach_session_name(plugin_state, pane)
		plugin_state.last_seen_ms = now
		pane_states[pane_id] = plugin_state
		return plugin_state
	end

	local has_opencode_process = pane_has_opencode_process(pane)
	local overlay_state = normalize_state(detect_overlay_state(pane, has_opencode_process), "overlay")

	if overlay_state then
		attach_session_name(overlay_state, pane)
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
	prune_closed_panes()

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
