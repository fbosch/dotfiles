#!/usr/bin/env lua

local socket = require("socket")

local config_dir = os.getenv("HOME") .. "/.config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local json = require("lib.json")
local command = require("lib.command")
local state_rules = require("runtime.windows.daemons.window-state.rules")
local hypr_ipc = require("runtime.lib.hypr-ipc")

local selectors_lua_file = config_dir .. "/rules/window-state-selectors.lua"
local rules_lua_file = config_dir .. "/rules/window-state.lua"
local runtime_dir = os.getenv("XDG_RUNTIME_DIR") or "/tmp"
local state_file = runtime_dir .. "/hypr-window-state.cache"
local debounce_file = runtime_dir .. "/hypr-window-state-debounce"
local debounce_delay = 1
local poll_interval_active_idle = 0.05
local poll_interval_active_busy = 0.15
local poll_interval_stable_idle = 1
local poll_interval_stable_busy = 1.5
local cpu_count = tonumber((io.popen("nproc 2>/dev/null"):read("*l"))) or 1

local selector_state = {
	selectors = {},
	matchers_json = "[]",
}
local monitors_json = "[]"
local monitors_cache_json = nil
local monitors_cache = {}
local rules_cache = {}
local current_hash = ""
local debounce_started_at = nil
local polling = false
local next_poll_at = nil
local lua_pattern_cache = {}

local function now()
	return socket.gettime()
end

local function log(message)
	io.stderr:write(os.date("%H:%M:%S"), " - ", message, "\n")
	io.stderr:flush()
end

local function read_file(path)
	local handle = io.open(path, "r")
	if not handle then
		return nil
	end
	local content = handle:read("*a")
	handle:close()
	return content
end

local function write_file(path, content)
	local handle = assert(io.open(path, "w"))
	handle:write(content)
	handle:close()
end

local query_socket_path = hypr_ipc.socket_path(".socket.sock")
local event_socket_path = hypr_ipc.socket_path(".socket2.sock")

local function request(message)
	return hypr_ipc.request(message, { path = query_socket_path })
end

local function parse_selectors()
	selector_state = state_rules.load_selectors(selectors_lua_file)
end

local function fetch_monitors()
	monitors_json = request("j/monitors")
	if not monitors_json or monitors_json == "" then
		monitors_json = "[]"
		error("monitors query failed")
	end
end

local function lua_pattern_for_regex(pattern)
	if lua_pattern_cache[pattern] then
		return lua_pattern_cache[pattern]
	end

	local parts = {}
	local escaped = false
	for index = 1, #pattern do
		local char = pattern:sub(index, index)
		if escaped then
			parts[#parts + 1] = "%" .. char
			escaped = false
		elseif char == "\\" then
			escaped = true
		elseif char == "-" then
			parts[#parts + 1] = "%-"
		else
			parts[#parts + 1] = char
		end
	end

	if escaped then
		parts[#parts + 1] = "\\"
	end

	local converted = table.concat(parts)
	lua_pattern_cache[pattern] = converted
	return converted
end

local function field_matches(value, pattern)
	if value == nil then
		return false
	end

	local ok, matched = pcall(string.match, tostring(value), lua_pattern_for_regex(pattern))
	return ok and matched ~= nil
end

local function matched_selector(client)
	for _, selector in ipairs(selector_state.selectors) do
		local field = state_rules.matcher_client_field(selector.matcher)
		if field and field_matches(client[field], selector.pattern) then
			return selector
		end
	end

	return nil
end

local function monitor_index()
	if monitors_cache_json == monitors_json then
		return monitors_cache
	end

	local indexed = {}
	for _, monitor in ipairs(json.array(monitors_json)) do
		indexed[tostring(monitor.id)] = {
			name = monitor.name or "",
			x = tonumber(monitor.x) or 0,
			y = tonumber(monitor.y) or 0,
		}
	end

	monitors_cache_json = monitors_json
	monitors_cache = indexed
	return monitors_cache
end

local function number_at(values, index)
	return tonumber(values and values[index]) or 0
end

local function get_window_states()
	if #selector_state.selectors == 0 then
		parse_selectors()
	end
	if #selector_state.selectors == 0 then
		return "[]"
	end

	local clients = request("j/clients")
	if not clients or clients == "" then
		log("ERROR: clients query failed")
		return "[]"
	end

	local mon_map = monitor_index()
	local windows = {}
	for _, client in ipairs(json.array(clients)) do
		if client.floating == true then
			local selector = matched_selector(client)
			if selector then
				local monitor = mon_map[tostring(client.monitor)] or { name = "", x = 0, y = 0 }
				windows[#windows + 1] = {
					class = client.class,
					matcher = selector.matcher,
					pattern = selector.pattern,
					monitor = monitor.name,
					x = number_at(client.at, 1) - monitor.x,
					y = number_at(client.at, 2) - monitor.y,
					width = number_at(client.size, 1),
					height = number_at(client.size, 2),
				}
			end
		end
	end

	table.sort(windows, function(left, right)
		return tostring(left.class or "") < tostring(right.class or "")
	end)
	return json.encode(windows)
end

local function is_state_empty(state)
	return not state or state == "" or state == "[]"
end

local function load_rules_cache()
	rules_cache = state_rules.load_rules_cache(rules_lua_file)
end

local function prune_stale_rules_cache()
	state_rules.prune_rules_cache(rules_cache, selector_state.selectors)
end

local function write_lua_rules_cache_file()
	return state_rules.write_rules_file({
		cache = rules_cache,
		config_dir = config_dir,
		selectors_lua_file = selectors_lua_file,
		rules_lua_file = rules_lua_file,
	})
end

local function apply_window_state_rules()
	local script = "local config_dir = "
		.. json.encode(config_dir)
		.. '; package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path; require("rule-loader").apply_window_rule_phase(config_dir, "window_state")'
	return command.ok("hyprctl eval " .. command.arg(script) .. " >/dev/null 2>&1")
end

local function update_rules(windows)
	if is_state_empty(windows) then
		return
	end

	if not next(rules_cache) then
		load_rules_cache()
	end
	prune_stale_rules_cache()

	state_rules.update_cache_from_windows(rules_cache, windows, log)

	local changed = write_lua_rules_cache_file()
	write_file(state_file, windows .. "\n")

	if not changed then
		log("Window-state rules unchanged")
		return
	end

	if apply_window_state_rules() then
		log("Window-state rules refreshed")
	else
		log("WARNING: Failed to refresh window-state rules")
	end
end

local function states_changed(state)
	if state ~= current_hash then
		current_hash = state
		return true
	end

	return false
end

local function start_polling()
	if polling then
		return
	end
	polling = true
	next_poll_at = now()
	log("Started polling")
end

local function stop_polling()
	if not polling then
		return
	end
	polling = false
	next_poll_at = nil
	log("Stopped polling")
end

local function load_is_busy()
	local handle = io.open("/proc/loadavg", "r")
	if not handle then
		return false
	end
	local load = handle:read("*n")
	handle:close()
	return load and load > cpu_count
end

local function adaptive_interval(mode)
	local busy = load_is_busy()
	if mode == "stable" then
		return busy and poll_interval_stable_busy or poll_interval_stable_idle
	end
	return busy and poll_interval_active_busy or poll_interval_active_idle
end

local function check_and_save_with_state(state)
	if is_state_empty(state) then
		return
	end

	if states_changed(state) then
		write_file(state_file, state .. "\n")
		debounce_started_at = now()
		write_file(debounce_file, tostring(math.floor(debounce_started_at)) .. "\n")
		log("State changed, starting " .. debounce_delay .. "s debounce")
		return
	end

	if debounce_started_at and now() - debounce_started_at >= debounce_delay then
		log("Debounce period elapsed, saving rules")
		update_rules(state)
		debounce_started_at = nil
		os.remove(debounce_file)
	end
end

local function flush_pending_cached_state()
	local state = read_file(state_file)
	if is_state_empty(state) then
		return false
	end

	state = state:gsub("%s+$", "")
	if is_state_empty(state) then
		return false
	end

	log("Flushing pending cached state")
	update_rules(state)
	current_hash = state
	debounce_started_at = nil
	os.remove(debounce_file)
	return true
end

local function immediate_save()
	local state = get_window_states()
	if is_state_empty(state) then
		if debounce_started_at or read_file(debounce_file) then
			flush_pending_cached_state()
		end
		return state
	end

	log("Immediate save triggered (window close)")
	update_rules(state)
	current_hash = state
	debounce_started_at = nil
	os.remove(debounce_file)
	return state
end

local function poll_once()
	local previous_hash = current_hash
	local had_debounce = debounce_started_at ~= nil
	local state = get_window_states()

	if is_state_empty(state) then
		log("No tracked windows, stopping poll")
		stop_polling()
		return
	end

	check_and_save_with_state(state)

	local mode = "stable"
	if state ~= previous_hash or had_debounce or debounce_started_at then
		mode = "active"
	end
	next_poll_at = now() + adaptive_interval(mode)
end

local function handle_event(event)
	if event:match("^openwindow") or event:match("^changefloatingmode") or event:match("^movewindow") or event:match("^resizewindow") then
		local state = get_window_states()
		if not is_state_empty(state) then
			start_polling()
			check_and_save_with_state(state)
		end
	elseif event:match("^closewindow") then
		local state = immediate_save()
		if not is_state_empty(state) then
			check_and_save_with_state(state)
		else
			stop_polling()
		end
	elseif event:match("^configreloaded") then
		parse_selectors()
		load_rules_cache()
		prune_stale_rules_cache()
		write_lua_rules_cache_file()
		local state = get_window_states()
		if not is_state_empty(state) then
			start_polling()
			check_and_save_with_state(state)
		else
			stop_polling()
		end
	elseif event:match("^monitoradded") or event:match("^monitorremoved") then
		local ok, err = pcall(fetch_monitors)
		if not ok then
			log("ERROR: " .. tostring(err))
		end
	end
end

local function connect_events()
	return hypr_ipc.connect_event_socket({ path = event_socket_path, read_timeout = 0 })
end

local function startup()
	hypr_ipc.assert_socket_connects(query_socket_path)
	hypr_ipc.assert_socket_connects(event_socket_path)

	print("Window state persistence started (LuaSocket events + adaptive polling)")
	print("Selectors: " .. selectors_lua_file)
	print("Rules: " .. rules_lua_file)
	print("Debounce delay: " .. debounce_delay .. "s")
	print("Scheduling: wrapper-provided SCHED_IDLE when available")
	print("Poll rate: Adaptive based on activity/load (active 0.05s-0.15s, stable 1s-1.5s)")
	print("")

	parse_selectors()
	load_rules_cache()
	prune_stale_rules_cache()
	write_lua_rules_cache_file()
	fetch_monitors()
	if read_file(debounce_file) then
		flush_pending_cached_state()
	end

	local initial_state = get_window_states()
	if not is_state_empty(initial_state) then
		log("Tracked windows detected, starting poll")
		start_polling()
		check_and_save_with_state(initial_state)
	else
		log("No tracked windows, idle (waiting for events)")
	end
end

local function run()
	startup()
	local events = connect_events()

	while true do
		local timeout = 1
		if polling and next_poll_at then
			timeout = math.max(0, math.min(timeout, next_poll_at - now()))
		end
		if debounce_started_at then
			timeout = math.max(0, math.min(timeout, debounce_started_at + debounce_delay - now()))
		end

		local ready = socket.select({ events }, nil, timeout)
		if #ready > 0 then
			while true do
				local line, err, partial = events:receive("*l")
				line = line or partial
				if line and line ~= "" then
					handle_event(line)
				end
				if err == "timeout" then
					break
				elseif err == "closed" then
					events:close()
					events = connect_events()
					break
				elseif err then
					break
				end
			end
		end

		if polling and next_poll_at and now() >= next_poll_at then
			local ok, err = pcall(poll_once)
			if not ok then
				log("ERROR: " .. tostring(err))
				next_poll_at = now() + poll_interval_stable_busy
			end
		elseif debounce_started_at and now() - debounce_started_at >= debounce_delay then
			local state = get_window_states()
			check_and_save_with_state(state)
		end
	end
end

local function usage(stream)
	stream:write("usage: ", arg[0], " [--help]\n")
end

if arg[1] == "--help" or arg[1] == "help" then
	usage(io.stdout)
	os.exit(0)
elseif arg[1] ~= nil then
	usage(io.stderr)
	os.exit(1)
end

local ok, err = pcall(run)
if not ok then
	io.stderr:write("ERROR: ", tostring(err), "\n")
	os.exit(1)
end
