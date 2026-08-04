local M = {}
local empty_opts = {}
local socket_paths = {}
local instance_runtime_dir = nil
local unix_socket_path_max = 107

function M.instance_runtime_dir()
	if instance_runtime_dir then
		return instance_runtime_dir
	end

	local runtime_dir = os.getenv("XDG_RUNTIME_DIR")
	local signature = os.getenv("HYPRLAND_INSTANCE_SIGNATURE")
	if not runtime_dir or not signature then
		error("missing Hyprland socket environment")
	end

	instance_runtime_dir = runtime_dir .. "/hypr/" .. signature
	return instance_runtime_dir
end

function M.instance_path(name)
	return M.instance_runtime_dir() .. "/" .. name
end

function M.instance_socket_path(name)
	local path = M.instance_path(name)
	if #path > unix_socket_path_max then
		error("Hyprland instance socket path is too long: " .. path)
	end

	return path
end

function M.socket_path(name)
	if socket_paths[name] then
		return socket_paths[name]
	end

	socket_paths[name] = M.instance_socket_path(name)
	return socket_paths[name]
end

function M.request(message, opts)
	opts = opts or empty_opts
	local unix = require("socket.unix")
	local client = assert(unix())
	client:settimeout(opts.timeout or 0.5)
	assert(client:connect(opts.path or M.socket_path(opts.socket_name or ".socket.sock")))
	assert(client:send(message))

	local response, _, partial = client:receive("*a")
	client:close()
	return response or partial or ""
end

function M.connect_event_socket(opts)
	opts = opts or empty_opts
	local unix = require("socket.unix")
	local client = assert(unix())
	client:settimeout(opts.connect_timeout or 0.5)
	assert(client:connect(opts.path or M.socket_path(".socket2.sock")))
	client:settimeout(opts.read_timeout)
	return client
end

function M.assert_socket_connects(path, timeout)
	local unix = require("socket.unix")
	local client = assert(unix())
	client:settimeout(timeout or 0.2)
	local ok, err = client:connect(path)
	client:close()
	assert(ok, path .. ": " .. tostring(err))
end

return M
