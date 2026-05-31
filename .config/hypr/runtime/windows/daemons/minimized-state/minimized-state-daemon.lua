#!/usr/bin/env lua

local socket = require("socket")

local home = os.getenv("HOME")
local runtime_dir = os.getenv("XDG_RUNTIME_DIR") or "/tmp"
local hypr_ipc = dofile(home .. "/.config/hypr/runtime/lib/hypr-ipc.lua")
local state_file = runtime_dir .. "/hypr-minimized-state.json"
local reconnect_delay_seconds = 1

local function shell_quote(value)
	return "'" .. tostring(value):gsub("'", "'\\''") .. "'"
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

local function command_ok(command)
	local ok = os.execute(command .. " >/dev/null 2>&1")
	return ok == true or ok == 0
end

local function init_state_file()
	if read_file(state_file) and command_ok("jq -e 'type == \"object\"' " .. shell_quote(state_file)) then
		return
	end

	write_file(state_file, "{}\n")
end

local function remove_address_entry(address)
	if not address or address == "" then
		return
	end

	local temp = os.tmpname()
	os.execute("jq --arg address " .. shell_quote(address) .. " 'del(.[$address])' " .. shell_quote(state_file) .. " > " .. shell_quote(temp))
	os.rename(temp, state_file)
end

local function prune_state_file()
	local clients = hypr_ipc.request("j/clients")
	local temp = os.tmpname()
	local command = "printf %s "
		.. shell_quote(clients)
		.. " | jq --slurpfile saved "
		.. shell_quote(state_file)
		.. " '([.[].address] | INDEX(.)) as $live | ($saved[0] // {}) | with_entries(select($live[.key] != null))' > "
		.. shell_quote(temp)
	os.execute(command)
	os.rename(temp, state_file)
end

local function handle_event(event)
	if not event:match("^closewindow") then
		return
	end

	local address = event:match(">>([^,]+)") or event:match("^[^,]+,([^,]+)")
	remove_address_entry(address)
end

local function run()
	init_state_file()
	prune_state_file()

	while true do
		init_state_file()
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
