-- Deep module for long-lived Hyprland Lua daemons: one interface hiding the
-- IPC transport, normalized compositor queries, event and owned control
-- sockets, and file helpers. Locking stays in shell launchers by design (see
-- CONTEXT.md). Tests inject transports and socket factories through new().

local json = require("lib.json")

local M = {}
M.restart_exit_status = tonumber(os.getenv("DAEMON_SUPERVISOR_RESTART_EXIT_STATUS")) or 75

local default_monitor_cache_ttl_s = 10

-- Read-only queries that may fall back to a one-shot hyprctl spawn when the
-- query socket is unavailable. State-changing dispatches never fall back.
local fallback_commands = {
	["j/activewindow"] = "hyprctl activewindow -j 2>/dev/null",
	["j/clients"] = "hyprctl clients -j 2>/dev/null",
	["j/monitors"] = "hyprctl monitors -j 2>/dev/null",
}

local function default_spawn(command_line)
	local command = require("lib.command")
	return command.output(command_line)
end

local function default_unix_server()
	local unix = require("socket.unix")
	return assert(unix())
end

local function production_clock()
	local ffi_available, ffi = pcall(require, "ffi")
	if ffi_available then
		pcall(
			ffi.cdef,
			[[
			typedef long time_t;
			struct timespec { time_t tv_sec; long tv_nsec; };
			int clock_gettime(int clockid, struct timespec *tp);
		]]
		)
		local timespec = ffi.new("struct timespec[1]")
		if ffi.C.clock_gettime(1, timespec) == 0 then
			return function()
				assert(ffi.C.clock_gettime(1, timespec) == 0, "clock_gettime failed")
				return tonumber(timespec[0].tv_sec) + tonumber(timespec[0].tv_nsec) / 1000000000
			end
		end
	end

	return os.clock
end

local function number(value)
	return tonumber(value) or 0
end

local function default_transport()
	local hypr_ipc = require("runtime.lib.hypr-ipc")
	return {
		request = function(message, opts)
			return hypr_ipc.request(message, opts)
		end,
		connect_event_socket = function(opts)
			return hypr_ipc.connect_event_socket(opts)
		end,
		socket_path = function(name)
			return hypr_ipc.socket_path(name)
		end,
		instance_path = function(name)
			return hypr_ipc.instance_path(name)
		end,
		assert_socket_connects = function(path, timeout)
			return hypr_ipc.assert_socket_connects(path, timeout)
		end,
	}
end

local function normalize_workspace(workspace)
	if type(workspace) ~= "table" then
		return nil
	end

	return {
		id = number(workspace.id),
		name = tostring(workspace.name or ""),
	}
end

local function normalize_monitor(monitor)
	if type(monitor) ~= "table" then
		return nil
	end

	local width = number(monitor.width)
	local height = number(monitor.height)
	if monitor.transform == 1 or monitor.transform == 3 then
		width, height = height, width
	end

	return {
		name = monitor.name or "",
		id = tostring(monitor.id),
		x = number(monitor.x),
		y = number(monitor.y),
		width = width,
		height = height,
		refresh_rate = number(monitor.refreshRate),
		activeWorkspace = normalize_workspace(monitor.activeWorkspace),
		specialWorkspace = normalize_workspace(monitor.specialWorkspace),
	}
end

local function normalize_client(client)
	if type(client) ~= "table" then
		return nil
	end

	local at = {}
	for index = 1, 2 do
		at[index] = number(client.at and client.at[index])
	end
	local size = {}
	for index = 1, 2 do
		size[index] = number(client.size and client.size[index])
	end

	client.at = at
	client.size = size
	return client
end

function M.new(opts)
	opts = opts or {}
	local transport = opts.transport or default_transport()
	local monitor_cache_ttl_s = opts.monitor_cache_ttl_s or default_monitor_cache_ttl_s
	local spawn = opts.spawn or default_spawn
	local unix_server = opts.unix_server or default_unix_server
	local remove = opts.remove or os.remove
	local clock = opts.clock or production_clock()

	local monitors_cache = nil
	local monitors_cached_at = -math.huge
	local state_write_sequence = 0

	local kit = {}

	function kit:socket_path(name)
		return transport.socket_path(name)
	end

	function kit:instance_path(name)
		return transport.instance_path(name)
	end

	function kit:assert_socket_connects(path, timeout)
		return transport.assert_socket_connects(path, timeout)
	end

	function kit:request(message, request_opts)
		local ok, response = pcall(transport.request, message, request_opts)
		if not ok then
			return nil, response
		end
		return response or "", nil
	end

	function kit:query(message)
		local response = kit:request(message)
		if response ~= nil and response ~= "" then
			return response
		end

		local fallback = fallback_commands[message]
		if not fallback then
			return ""
		end

		return spawn(fallback)
	end

	function kit:monitors(query_opts)
		local force = query_opts and query_opts.force
		if not force and os.time() - monitors_cached_at <= monitor_cache_ttl_s and monitors_cache then
			return monitors_cache, nil
		end

		local response, err
		if query_opts and query_opts.fallback then
			response = kit:query("j/monitors")
		else
			response, err = kit:request("j/monitors")
		end
		if err ~= nil then
			return monitors_cache or {}, err
		end

		local normalized = {}
		for _, monitor in ipairs(json.array(response)) do
			local record = normalize_monitor(monitor)
			if record then
				normalized[#normalized + 1] = record
			end
		end

		monitors_cache = normalized
		monitors_cached_at = os.time()
		return normalized, nil
	end

	function kit:clients(query_opts)
		local response, err
		if query_opts and query_opts.fallback then
			response = kit:query("j/clients")
		else
			response, err = kit:request("j/clients")
		end
		if err ~= nil then
			return {}, err
		end

		local normalized = {}
		for _, client in ipairs(json.array(response)) do
			local record = normalize_client(client)
			if record then
				normalized[#normalized + 1] = record
			end
		end
		return normalized, nil
	end

	function kit:connect_events(event_opts)
		return transport.connect_event_socket(event_opts)
	end

	function kit:control_socket(name)
		local path = kit:socket_path(name)
		local server = unix_server()
		assert(server:bind(path))
		assert(server:listen())
		server:settimeout(0)
		local owned = true

		local control = {}

		function control:reader()
			return server
		end

		local function receive_message(client)
			local deadline = clock() + 0.05
			local bytes = {}
			for _ = 1, 4097 do
				local remaining = deadline - clock()
				if remaining <= 0 then
					return nil, "request-timeout"
				end
				client:settimeout(remaining)
				local byte, err = client:receive(1)
				if not byte then
					return nil, err or "incomplete-request"
				end
				if clock() >= deadline then
					return nil, "request-timeout"
				end
				if byte == "\n" then
					return table.concat(bytes):gsub("\r$", "")
				end
				bytes[#bytes + 1] = byte
				if #bytes > 4096 then
					return nil, "request-too-large"
				end
			end
			return nil, "request-too-large"
		end
		function control:handle_ready(handler)
			assert(server, "control socket is closed")
			local client = server:accept()
			if not client then
				return false
			end

			local message, receive_error = receive_message(client)
			local result
			local response
			if not message then
				response = "error: " .. receive_error
			elseif message == "restart" then
				result = "restart"
			else
				local handled, handler_result, handler_response = pcall(handler, message)
				if handled then
					result, response = handler_result, handler_response
				else
					response = "error: handler-failed"
				end
			end
			client:send((response or "ok") .. "\n")
			client:close()
			return result
		end

		function control:close()
			if server then
				server:close()
				server = nil
			end
			if owned then
				remove(path)
				owned = false
			end
		end

		return control
	end

	function kit:read_file(path)
		local handle = io.open(path, "r")
		if not handle then
			return nil
		end
		local content = handle:read("*a")
		handle:close()
		return content
	end

	function kit:remove_file(path)
		local removed, err = remove(path)
		if removed or (err and err:match("No such file")) then
			return true
		end
		error(err or ("failed to remove " .. path), 0)
	end

	function kit:write_file(path, content)
		local handle = assert(io.open(path, "w"))
		handle:write(content)
		handle:close()
	end

	function kit:write_shared_file(path, content)
		state_write_sequence = state_write_sequence + 1
		local temporary = string.format("%s.%d.%d.tmp", path, os.time(), state_write_sequence)
		local handle = assert(io.open(temporary, "w"))
		local written, write_error = handle:write(content)
		if not written then
			handle:close()
			remove(temporary)
			error(write_error, 0)
		end
		local closed, close_error = handle:close()
		if not closed then
			remove(temporary)
			error(close_error, 0)
		end
		local renamed, rename_error = os.rename(temporary, path)
		if not renamed then
			remove(temporary)
			error(rename_error, 0)
		end
	end

	return kit
end

return M
