#!/usr/bin/env lua

local socket = require("socket")

local home = os.getenv("HOME")
local hypr_ipc = dofile(home .. "/.config/hypr/runtime/lib/hypr-ipc.lua")
local state_command = home .. "/.config/hypr/runtime/windows/minimized-state.lua"
local reconnect_delay_seconds = 1

local function shell_quote(value)
	return "'" .. tostring(value):gsub("'", "'\\''") .. "'"
end

local function command_ok(command)
	local ok = os.execute(command .. " >/dev/null 2>&1")
	return ok == true or ok == 0
end

local function state_command_ok(...)
	local command = { shell_quote(state_command) }
	for _, value in ipairs({ ... }) do
		command[#command + 1] = shell_quote(value)
	end
	return command_ok(table.concat(command, " "))
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

	while true do
		state_command_ok("init")
		local ok, err = pcall(function()
			local events = hypr_ipc.connect_event_socket()
			while true do
				local line, read_err, partial = events:receive("*l")
				line = line or partial
				if line and line ~= "" then
					handle_event(line)
				end
				if read_err then
					events:close()
					break
				end
			end
		end)
		if not ok then
			io.stderr:write("minimized-state-daemon: ", tostring(err), "\n")
		end
		socket.sleep(reconnect_delay_seconds)
	end
end

run()
