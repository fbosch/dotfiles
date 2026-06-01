local unix = require("socket.unix")

local M = {}
local empty_opts = {}
local socket_paths = {}

function M.socket_path(name)
	if socket_paths[name] then
		return socket_paths[name]
	end

	local runtime_dir = os.getenv("XDG_RUNTIME_DIR")
	local signature = os.getenv("HYPRLAND_INSTANCE_SIGNATURE")
	if not runtime_dir or not signature then
		error("missing Hyprland socket environment")
	end

	socket_paths[name] = runtime_dir .. "/hypr/" .. signature .. "/" .. name
	return socket_paths[name]
end

function M.request(message, opts)
	opts = opts or empty_opts
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
	local client = assert(unix())
	client:settimeout(opts.connect_timeout or 0.5)
	assert(client:connect(opts.path or M.socket_path(".socket2.sock")))
	client:settimeout(opts.read_timeout)
	return client
end

function M.assert_socket_connects(path, timeout)
	local client = assert(unix())
	client:settimeout(timeout or 0.2)
	local ok, err = client:connect(path)
	client:close()
	assert(ok, path .. ": " .. tostring(err))
end

return M
