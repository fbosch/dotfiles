#!/usr/bin/env luajit

local socket = require("socket")

local config_dir = os.getenv("HOME") .. "/.config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local command = require("lib.command")
local daemon = require("runtime.lib.daemon")
local pip = require("lib.picture_in_picture")
local rate_limit = require("lib.rate_limit")
local capture = require("runtime.windows.daemons.window-state.capture")
local publication = require("runtime.windows.daemons.window-state.publication")
local state_rules = require("runtime.windows.daemons.window-state.rules")

local selectors_lua_file = config_dir .. "/rules/window-state-selectors.lua"
local kit = daemon.new({})
local state_file = kit:instance_path("window-state.cache")
local debounce_file = kit:instance_path("window-state-debounce")
local debounce_delay = 1
local placement_activation_delay = 0.25
local poll_interval_active_idle = 0.05
local poll_interval_active_busy = 0.15
local poll_interval_stable_idle = 1
local poll_interval_stable_busy = 1.5
local event_reconnect_delay = 1
local event_reconnect_log_interval = 30
local cpu_count = tonumber((io.popen("nproc 2>/dev/null"):read("*l"))) or 1

local selector_state = {
	selectors = {},
	matchers_json = "[]",
}
local monitors = {}
local current_hash = ""
local debounce_started_at = nil
local polling = false
local next_poll_at = nil
local event_reconnect_at = nil
local control_socket = nil
local placement_activation_at = nil

local function now()
	return socket.gettime()
end

local function log(message)
	io.stderr:write(os.date("%H:%M:%S"), " window-state: ", message, "\n")
	io.stderr:flush()
end

local publisher = publication.new({
	kit = kit,
	config_dir = config_dir,
	reload = function()
		return command.ok("hyprctl reload config-only >/dev/null 2>&1")
	end,
	log = log,
})

local log_rate_limited, reset_rate_limit = rate_limit.new(log, event_reconnect_log_interval, now)

local query_socket_path = kit:socket_path(".socket.sock")
local event_socket_path = kit:socket_path(".socket2.sock")

local function request(message)
	return kit:request(message, { path = query_socket_path })
end

local function parse_selectors()
	selector_state = state_rules.load_selectors(selectors_lua_file)
end

local function fetch_monitors()
	local fetched, err = kit:monitors({ force = true })
	if err ~= nil or next(fetched) == nil then
		error("monitors query failed")
	end
	monitors = fetched
end

local function get_window_states()
	if #selector_state.selectors == 0 then
		parse_selectors()
	end
	if #selector_state.selectors == 0 then
		return "[]"
	end

	local clients, clients_err = kit:clients()
	if clients_err ~= nil then
		log_rate_limited("clients-query", "clients query failed")
		return "[]"
	end

	return capture.snapshot(selector_state.selectors, clients, monitors)
end

local function is_state_empty(state)
	return not state or state == "" or state == "[]"
end

local function update_rules(windows)
	publisher:publish(windows, selector_state.selectors)
end

local function handle_control(message)
	if message == "ping" then
		return false, "ok"
	end

	local placement, decode_err = pip.acceptance.decode(message)
	if placement == nil then
		log_rate_limited("pip-placement", "rejected PiP placement: " .. tostring(decode_err))
		return false, "error"
	end

	local ok, accepted, activation_or_err = pcall(function()
		return publisher:accept_pip_placement(placement, selector_state.selectors)
	end)
	if not ok or accepted == nil then
		log_rate_limited(
			"pip-placement",
			"failed to persist PiP placement: " .. tostring(activation_or_err or accepted)
		)
		return false, "error"
	end
	if activation_or_err == true then
		-- Keep rule activation outside the acknowledgement path and collapse rapid placements.
		placement_activation_at = now() + placement_activation_delay
	end

	reset_rate_limit("pip-placement")
	return false, "ok"
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
end

local function stop_polling()
	if not polling then
		return
	end
	polling = false
	next_poll_at = nil
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

local function schedule_active_poll()
	local deadline = now() + adaptive_interval("active")
	if not polling then
		polling = true
	end

	if next_poll_at == nil or next_poll_at > deadline then
		next_poll_at = deadline
	end
end

local function check_and_save_with_state(state)
	if is_state_empty(state) then
		return
	end

	if states_changed(state) then
		kit:write_shared_file(state_file, state .. "\n")
		debounce_started_at = now()
		kit:write_file(debounce_file, tostring(math.floor(debounce_started_at)) .. "\n")
		return
	end

	if debounce_started_at and now() - debounce_started_at >= debounce_delay then
		update_rules(state)
		debounce_started_at = nil
		os.remove(debounce_file)
	end
end

local function flush_pending_cached_state()
	local state = kit:read_file(state_file)
	if is_state_empty(state) then
		return false
	end

	state = state:gsub("%s+$", "")
	if is_state_empty(state) then
		return false
	end

	update_rules(state)
	current_hash = state
	debounce_started_at = nil
	os.remove(debounce_file)
	return true
end

local function immediate_save()
	local state = get_window_states()
	if is_state_empty(state) then
		if debounce_started_at or kit:read_file(debounce_file) then
			flush_pending_cached_state()
		end
		return state
	end

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
	if event:match("^openwindow") or event:match("^changefloatingmode") then
		local state = get_window_states()
		if not is_state_empty(state) then
			start_polling()
			check_and_save_with_state(state)
		end
	elseif event:match("^movewindow") or event:match("^resizewindow") then
		-- Coalesce compositor-rate geometry events into the active polling interval.
		schedule_active_poll()
	elseif event:match("^closewindow") then
		local state = immediate_save()
		if not is_state_empty(state) then
			check_and_save_with_state(state)
		else
			stop_polling()
		end
	elseif event:match("^configreloaded") then
		parse_selectors()
		publisher:reconcile(selector_state.selectors)
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
	return kit:connect_events({ path = event_socket_path, read_timeout = 0 })
end

local function schedule_event_reconnect(events, reason)
	if events then
		events:close()
	end
	if event_reconnect_at then
		return nil
	end

	event_reconnect_at = now() + event_reconnect_delay
	log_rate_limited(
		"event-reconnect",
		"event socket " .. tostring(reason) .. "; retrying in " .. event_reconnect_delay .. "s"
	)
	return nil
end

local function reconnect_events()
	if not event_reconnect_at or now() < event_reconnect_at then
		return nil
	end

	local ok, events_or_err = pcall(connect_events)
	if ok then
		event_reconnect_at = nil
		reset_rate_limit("event-reconnect")
		log("event socket reconnected")
		return events_or_err
	end

	event_reconnect_at = now() + event_reconnect_delay
	log_rate_limited(
		"event-reconnect",
		"event socket reconnect failed ("
			.. tostring(events_or_err)
			.. "); retrying in "
			.. event_reconnect_delay
			.. "s"
	)
	return nil
end

local function startup()
	kit:assert_socket_connects(query_socket_path)
	kit:assert_socket_connects(event_socket_path)

	log("started (LuaSocket events + adaptive polling)")

	parse_selectors()
	publisher:reconcile(selector_state.selectors, true)
	fetch_monitors()
	if kit:read_file(debounce_file) then
		flush_pending_cached_state()
	end

	local initial_state = get_window_states()
	if not is_state_empty(initial_state) then
		start_polling()
		check_and_save_with_state(initial_state)
	end

	-- The launcher lock guarantees that only this daemon may replace a stale control socket.
	os.remove(kit:socket_path("window-state.sock"))
	control_socket = kit:control_socket("window-state.sock")
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
		if event_reconnect_at then
			timeout = math.max(0, math.min(timeout, event_reconnect_at - now()))
		end
		if placement_activation_at then
			timeout = math.max(0, math.min(timeout, placement_activation_at - now()))
		end

		local readers = { control_socket:reader() }
		if events then
			readers[#readers + 1] = events
		end
		local event_reader = events
		local ready = socket.select(readers, nil, timeout)
		for _, reader in ipairs(ready) do
			if reader == event_reader then
				while true do
					local line, err, partial = reader:receive("*l")
					line = line or partial
					if line and line ~= "" then
						handle_event(line)
					end
					if err == "timeout" then
						break
					elseif err then
						events = schedule_event_reconnect(reader, err)
						break
					end
				end
			else
				control_socket:handle_ready(handle_control)
			end
		end
		events = reconnect_events() or events
		if placement_activation_at and now() >= placement_activation_at then
			placement_activation_at = nil
			publisher:activate()
		end

		if polling and next_poll_at and now() >= next_poll_at then
			local ok, err = pcall(poll_once)
			if not ok then
				log_rate_limited("poll", "poll failed: " .. tostring(err))
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
if control_socket then
	control_socket:close()
end
if not ok then
	io.stderr:write("ERROR: ", tostring(err), "\n")
	os.exit(1)
end
