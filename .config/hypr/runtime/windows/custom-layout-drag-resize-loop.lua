#!/usr/bin/env lua

local socket = require("socket")
local unix = require("socket.unix")

local function socket_path()
	local runtime_dir = os.getenv("XDG_RUNTIME_DIR")
	local signature = os.getenv("HYPRLAND_INSTANCE_SIGNATURE")
	if not runtime_dir or not signature then
		error("missing Hyprland socket environment")
	end

	return runtime_dir .. "/hypr/" .. signature .. "/.socket.sock"
end

local function request(path, message)
	local client = assert(unix())
	client:settimeout(0.2)
	assert(client:connect(path))
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

local function cursor_axis(path, axis)
	local response = request(path, "j/cursorpos")
	local value = response:match('"' .. axis .. '"%s*:%s*(-?%d+)')
	if not value then
		error("cursor response missing " .. axis)
	end

	return tonumber(value)
end

local function dispatch(path, command, edge, position)
	request(path, string.format('dispatch hl.dsp.layout("%s %s %d")', command, edge, position))
end

local function file_exists(path)
	local handle = io.open(path, "r")
	if handle then
		handle:close()
		return true
	end

	return false
end

local function unlink(path)
	os.remove(path)
end

local function scaled_position(initial, current, numerator, denominator)
	local delta = (current - initial) * numerator / denominator
	if delta >= 0 then
		return initial + math.floor(delta)
	end

	return initial + math.ceil(delta)
end

local function main(args)
	if #args ~= 10 then
		io.stderr:write(
			"usage: custom-layout-drag-resize-loop.lua axis command edge initial poll_interval dispatch_interval numerator denominator state_file pid_file\n"
		)
		return 2
	end

	local axis = args[1]
	local command = args[2]
	local edge = args[3]
	local initial = tonumber(args[4])
	local poll_interval = tonumber(args[5])
	local dispatch_interval = tonumber(args[6])
	local numerator = tonumber(args[7])
	local denominator = tonumber(args[8])
	local state_file = args[9]
	local pid_file = args[10]
	local path = socket_path()
	local last_sent = nil
	local pending = nil
	local next_dispatch = 0

	local function flush_pending()
		if not pending or pending == last_sent then
			return
		end

		dispatch(path, command, edge, pending)
		last_sent = pending
		pending = nil
		next_dispatch = socket.gettime() + dispatch_interval
	end

	for _ = 1, 1200 do
		if not file_exists(state_file) then
			break
		end

		local ok, current = pcall(cursor_axis, path, axis)
		if ok then
			local scaled = scaled_position(initial, current, numerator, denominator)
			if scaled ~= last_sent then
				pending = scaled
			end

			if pending and socket.gettime() >= next_dispatch then
				pcall(flush_pending)
			end
		end

		socket.sleep(poll_interval)
	end

	pcall(flush_pending)
	unlink(state_file)
	unlink(pid_file)
	return 0
end

os.exit(main(arg or {}))
