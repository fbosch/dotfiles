#!/usr/bin/env luajit

local socket = require("socket")

local home = os.getenv("HOME")
local config_dir = home .. "/.config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local command = require("lib.command")
local hypr_ipc = require("runtime.lib.hypr-ipc")
local state_command = home .. "/.config/hypr/runtime/windows/minimized-state.lua"
local reconnect_delay_seconds = 1
local diagnostic_interval_seconds = 30
local last_diagnostic_at = {}

local function log(message)
	io.stderr:write("minimized-state-daemon: ", message, "\n")
	io.stderr:flush()
end

local function log_diagnostic(key, message)
	local timestamp = socket.gettime()
	local previous = last_diagnostic_at[key]
	if previous and timestamp - previous < diagnostic_interval_seconds then
		return
	end

	last_diagnostic_at[key] = timestamp
	log(message)
end

local function state_command_ok(...)
	local parts = { command.arg(state_command) }
	for _, value in ipairs({ ... }) do
		parts[#parts + 1] = command.arg(value)
	end
	return command.ok(table.concat(parts, " ") .. " >/dev/null 2>&1")
end

local function remove_address_entry(address)
	state_command_ok("delete", address or "")
end

local function prune_state_file()
	state_command_ok("prune")
end

local function handle_event(event)
	if not event:match("^closewindow") then
		return
	end

	local address = event:match(">>([^,]+)") or event:match("^[^,]+,([^,]+)")
	remove_address_entry(address)
end

local function run()
	state_command_ok("init")
	prune_state_file()
	log("started")
	local reconnect_pending = false

	while true do
		state_command_ok("init")
		local ok, err = pcall(function()
			local events = hypr_ipc.connect_event_socket()
			if reconnect_pending then
				log_diagnostic("event-recovered", "event socket reconnected")
				reconnect_pending = false
			end
			while true do
				local line, read_err, partial = events:receive("*l")
				line = line or partial
				if line and line ~= "" then
					handle_event(line)
				end
				if read_err then
					events:close()
					reconnect_pending = true
					log_diagnostic(
						"event-disconnect",
						"event socket " .. tostring(read_err) .. "; retrying in " .. reconnect_delay_seconds .. "s"
					)
					break
				end
			end
		end)
		if not ok then
			reconnect_pending = true
			log_diagnostic(
				"event-retry-failed",
				"event socket recovery failed (" .. tostring(err) .. "); retrying in " .. reconnect_delay_seconds .. "s"
			)
		end
		socket.sleep(reconnect_delay_seconds)
	end
end

run()
