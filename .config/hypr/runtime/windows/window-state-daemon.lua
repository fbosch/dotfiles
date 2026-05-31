#!/usr/bin/env lua

local socket = require("socket")
local unix = require("socket.unix")

local config_dir = os.getenv("HOME") .. "/.config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local json = require("lib.json")

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

local matcher_patterns = {}
local matchers_json = "[]"
local monitors_json = "[]"
local rules_cache = {}
local current_hash = ""
local debounce_started_at = nil
local polling = false
local next_poll_at = nil

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

local function shell_quote(value)
	return "'" .. tostring(value):gsub("'", "'\\''") .. "'"
end

local function temp_path(prefix)
	local command = "mktemp " .. shell_quote(runtime_dir .. "/" .. prefix .. ".XXXXXX")
	local handle = assert(io.popen(command, "r"))
	local path = handle:read("*l")
	handle:close()
	assert(path and path ~= "", "failed to create temporary file")
	return path
end

local function temp_path_in(directory, prefix)
	local command = "mktemp " .. shell_quote(directory .. "/" .. prefix .. ".XXXXXX")
	local handle = assert(io.popen(command, "r"))
	local path = handle:read("*l")
	handle:close()
	assert(path and path ~= "", "failed to create temporary file")
	return path
end

local function socket_path(kind)
	local signature = os.getenv("HYPRLAND_INSTANCE_SIGNATURE")
	if not signature then
		error("HYPRLAND_INSTANCE_SIGNATURE is not set")
	end

	return runtime_dir .. "/hypr/" .. signature .. "/" .. kind
end

local query_socket_path = socket_path(".socket.sock")
local event_socket_path = socket_path(".socket2.sock")

local function request(message)
	local client = assert(unix())
	client:settimeout(0.5)
	assert(client:connect(query_socket_path))
	assert(client:send(message))

	local chunks = {}
	while true do
		local chunk, err, partial = client:receive(4096)
		chunk = chunk or partial
		if chunk and #chunk > 0 then
			chunks[#chunks + 1] = chunk
		end
		if err == "closed" then
			break
		end
		if err and err ~= "timeout" then
			break
		end
	end

	client:close()
	return table.concat(chunks)
end

local function parse_selectors()
	local ok, selectors = pcall(dofile, selectors_lua_file)
	matcher_patterns = {}

	if not ok or type(selectors) ~= "table" then
		matchers_json = "[]"
		return
	end

	local matchers = {}
	for _, selector in ipairs(selectors) do
		if type(selector) == "table" and type(selector.matcher) == "string" and type(selector.pattern) == "string" then
			local field = nil
			if selector.matcher == "match:class" then
				field = "class"
			elseif selector.matcher == "match:title" then
				field = "title"
			elseif selector.matcher == "match:initialClass" or selector.matcher == "match:initial_class" then
				field = "initialClass"
			elseif selector.matcher == "match:initialTitle" or selector.matcher == "match:initial_title" then
				field = "initialTitle"
			end

			if field then
				matcher_patterns[#matcher_patterns + 1] = selector
				matchers[#matchers + 1] = {
					matcher = selector.matcher,
					pattern = selector.pattern,
					field = field,
				}
			end
		end
	end

	matchers_json = json.encode(matchers)
end

local function pattern_is_regex(pattern)
	return pattern:find("[%.%[%]%(%)%*%+%?%^%$]") ~= nil
end

local function window_state_rule_pattern(pattern)
	if pattern_is_regex(pattern) then
		return pattern
	end

	return "^" .. pattern .. "$"
end

local function matcher_to_lua_key(matcher)
	if matcher == "match:class" then
		return "class"
	elseif matcher == "match:title" then
		return "title"
	elseif matcher == "match:initialClass" or matcher == "match:initial_class" then
		return "initial_class"
	elseif matcher == "match:initialTitle" or matcher == "match:initial_title" then
		return "initial_title"
	end

	return nil
end

local function window_state_lua_id(matcher, pattern)
	return "window-state:" .. matcher .. ":" .. pattern
end

local function fetch_monitors()
	monitors_json = request("j/monitors")
	if not monitors_json or monitors_json == "" then
		monitors_json = "[]"
		error("monitors query failed")
	end
end

local state_jq_filter = [[
def field_of(w; m): w | if   m.field == "class"        then .class
                         elif m.field == "title"        then .title
                         elif m.field == "initialClass" then .initialClass
                         elif m.field == "initialTitle" then .initialTitle
                         else empty end;
($monitors | map({id, name, x, y}) | INDEX(.id)) as $mon_map |
[.[] | select(.floating) |
. as $w |
first($matchers[] | . as $m | select(field_of($w; $m) | test($m.pattern))) as $matched |
($mon_map[$w.monitor | tostring] // {name: "", x: 0, y: 0}) as $mon |
{
  class: $w.class,
  matcher: $matched.matcher,
  pattern: $matched.pattern,
  monitor: $mon.name,
  x: ($w.at[0] - $mon.x),
  y: ($w.at[1] - $mon.y),
  width: $w.size[0],
  height: $w.size[1]
}] | sort_by(.class)
]]

local function get_window_states()
	if #matcher_patterns == 0 then
		parse_selectors()
	end
	if #matcher_patterns == 0 then
		return "[]"
	end

	local clients = request("j/clients")
	if not clients or clients == "" then
		log("ERROR: clients query failed")
		return "[]"
	end

	local command = table.concat({
		"printf %s " .. shell_quote(clients),
		"| jq -c",
		"--argjson matchers " .. shell_quote(matchers_json),
		"--argjson monitors " .. shell_quote(monitors_json),
		shell_quote(state_jq_filter),
	}, " ")
	local handle = io.popen(command, "r")
	local output = handle and handle:read("*a") or ""
	local ok = handle and handle:close()

	if not ok or output == "" then
		log("ERROR: jq state extraction failed")
		return "[]"
	end

	return (output:gsub("%s+$", ""))
end

local function is_state_empty(state)
	return not state or state == "" or state == "[]"
end

local function rule_cache_entry(matcher, pattern, monitor, x, y, width, height)
	return {
		matcher = matcher,
		pattern = pattern,
		monitor = monitor,
		x = tonumber(x),
		y = tonumber(y),
		width = tonumber(width),
		height = tonumber(height),
	}
end

local function load_rules_cache()
	rules_cache = {}

	local ok, rules = pcall(dofile, rules_lua_file)
	if not ok or type(rules) ~= "table" then
		return
	end

	for _, rule in ipairs(rules) do
		if type(rule) == "table" and type(rule.comment) == "string" and type(rule.effects) == "table" then
			local matcher, pattern = rule.comment:match("^(match:[^%s]+)%s+(.+)$")
			local size = rule.effects.size
			local move = rule.effects.move
			if matcher and pattern and type(size) == "table" and type(move) == "table" then
				local key = matcher .. " " .. pattern
				rules_cache[key] = rule_cache_entry(
					matcher,
					pattern,
					rule.effects.monitor or "",
					move[1],
					move[2],
					size[1],
					size[2]
				)
			end
		end
	end
end

local function prune_stale_rules_cache()
	local valid = {}
	for _, selector in ipairs(matcher_patterns) do
		valid[selector.matcher .. " " .. selector.pattern] = true
	end
	for key in pairs(rules_cache) do
		if not valid[key] then
			rules_cache[key] = nil
		end
	end
end

local function sorted_cache_keys()
	local keys = {}
	for key in pairs(rules_cache) do
		keys[#keys + 1] = key
	end
	table.sort(keys)
	return keys
end

local function write_lua_rules_cache_file()
	local rules_dir = config_dir .. "/rules"
	os.execute("mkdir -p " .. shell_quote(rules_dir))
	local temp = temp_path_in(rules_dir, ".window-state")
	local handle = assert(io.open(temp, "w"))

	handle:write("-- Auto-generated Lua window state persistence rules\n")
	handle:write("-- Selectors: ", selectors_lua_file, "\n")
	handle:write("-- DO NOT EDIT MANUALLY - This file is managed by window-state.sh\n\n")
	handle:write("return {\n")

	for _, key in ipairs(sorted_cache_keys()) do
		local entry = rules_cache[key]
		local lua_match_key = matcher_to_lua_key(entry.matcher)
		if lua_match_key then
			local rule_pattern = window_state_rule_pattern(entry.pattern)
			handle:write("  -- ", key, "\n")
			handle:write("  {\n")
			handle:write("    id = ", json.encode(window_state_lua_id(entry.matcher, entry.pattern)), ",\n")
			handle:write("    match = {\n")
			handle:write("      ", lua_match_key, " = ", json.encode(rule_pattern), ",\n")
			handle:write("    },\n")
			handle:write("    effects = {\n")
			if entry.monitor and entry.monitor ~= "" then
				handle:write("      monitor = ", json.encode(entry.monitor), ",\n")
			end
			handle:write("      size = { ", entry.width, ", ", entry.height, " },\n")
			handle:write("      move = { ", entry.x, ", ", entry.y, " },\n")
			handle:write("    },\n")
			handle:write("    source = \"window-state\",\n")
			handle:write("    comment = ", json.encode(key), ",\n")
			handle:write("  },\n\n")
		end
	end

	handle:write("}\n")
	handle:close()

	local existing = read_file(rules_lua_file)
	local next_content = read_file(temp)
	if existing == next_content then
		os.remove(temp)
		return false
	end

	assert(os.rename(temp, rules_lua_file))
	return true
end

local function apply_window_state_rules()
	local script = "local config_dir = "
		.. json.encode(config_dir)
		.. '; package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path; require("rule-loader").apply_window_rule_phase(config_dir, "window_state")'
	local ok = os.execute("hyprctl eval " .. shell_quote(script) .. " >/dev/null 2>&1")
	return ok == true or ok == 0
end

local function update_rules(windows)
	if is_state_empty(windows) then
		return
	end

	if not next(rules_cache) then
		load_rules_cache()
	end
	prune_stale_rules_cache()

	local command = "printf %s "
		.. shell_quote(windows)
		.. " | jq -r "
		.. shell_quote([[.[] | "\(.class)|\(.matcher)|\(.pattern)|\(.monitor)|\(.x)|\(.y)|\(.width)|\(.height)"]])
	local handle = io.popen(command, "r")
	for line in handle:lines() do
		local class, matcher, pattern, monitor, x, y, width, height = line:match("^([^|]*)|([^|]*)|([^|]*)|([^|]*)|([^|]*)|([^|]*)|([^|]*)|([^|]*)$")
		if class and class ~= "" then
			local key = matcher .. " " .. pattern
			rules_cache[key] = rule_cache_entry(matcher, pattern, monitor, x, y, width, height)
			log(string.format('Updated %s "%s": %sx%s at (%s,%s) on %s', matcher, pattern, width, height, x, y, monitor ~= "" and monitor or "unknown"))
		end
	end
	if handle then
		handle:close()
	end

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
	local client = assert(unix())
	client:settimeout(0.5)
	assert(client:connect(event_socket_path))
	client:settimeout(0)
	return client
end

local function assert_socket_connects(path)
	local client = assert(unix())
	client:settimeout(0.2)
	local ok, err = client:connect(path)
	client:close()
	assert(ok, path .. ": " .. tostring(err))
end

local function startup()
	assert_socket_connects(query_socket_path)
	assert_socket_connects(event_socket_path)

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

local ok, err = pcall(run)
if not ok then
	io.stderr:write("ERROR: ", tostring(err), "\n")
	os.exit(1)
end
