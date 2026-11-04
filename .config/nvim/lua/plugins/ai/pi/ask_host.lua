local uv = vim.uv
local hosts = {}

local function frozen(values)
	return setmetatable({}, {
		__index = values,
		__newindex = function()
			error("Pi Ask adapter is immutable", 2)
		end,
		__metatable = false,
	})
end

local function start(options)
	if
		type(options) ~= "table"
		or type(options.bind) ~= "function"
		or type(options.acknowledge) ~= "function"
		or type(options.closed) ~= "function"
		or type(options.launchId) ~= "string"
		or #options.launchId ~= 32
		or not options.launchId:match("^[a-f0-9]+$")
		or type(options.cwd) ~= "string"
		or uv.fs_realpath(options.cwd) ~= options.cwd
	then
		error("invalid Pi Ask host configuration")
	end
	if hosts[options.launchId] then
		error("Pi Ask launch already registered")
	end

	local socket = vim.v.servername
	if socket == "" then
		socket = vim.fn.serverstart()
	end
	socket = uv.fs_realpath(socket)
	if socket == nil then
		error("Neovim RPC socket unavailable")
	end
	local peer, stopped = nil, false
	local methods = {}

	function methods.is_open(channel)
		if stopped or peer ~= channel then
			return false
		end
		local ok, info = pcall(vim.api.nvim_get_chan_info, channel)
		return ok and info.mode == "rpc"
	end
	function methods.close(channel)
		if peer ~= channel then
			return false
		end
		peer = nil
		pcall(vim.rpcnotify, channel, "pi:nvim-close/v1")
		options.closed(channel)
		return true
	end
	function methods.notify(channel, method, request)
		if method ~= "pi:nvim-prompt/v1" or not methods.is_open(channel) then
			return false
		end
		return pcall(vim.rpcnotify, channel, method, request)
	end
	function methods.stop()
		if stopped then
			return
		end
		if peer then
			methods.close(peer)
		end
		stopped = true
		hosts[options.launchId] = nil
	end

	hosts[options.launchId] = {
		bind = function(channel, cwd, session_id)
			if stopped or cwd ~= options.cwd then
				return false
			end
			if peer and not methods.is_open(peer) then
				methods.close(peer)
			end
			if peer ~= nil then
				return false
			end
			local info = vim.api.nvim_get_chan_info(channel)
			if info.mode ~= "rpc" then
				return false
			end
			peer = channel
			local ok, binding = pcall(options.bind, {
				channelId = channel,
				editorPid = vim.fn.getpid(),
				launchId = options.launchId,
				cwd = cwd,
				sessionId = session_id,
				replacePending = true,
			})
			if not ok or type(binding) ~= "table" then
				methods.close(channel)
				return false
			end
			return binding
		end,
		acknowledge = function(channel, payload)
			if not methods.is_open(channel) then
				return false
			end
			return options.acknowledge(payload, channel)
		end,
		close = methods.close,
	}
	methods.socketPath = socket
	return frozen(methods)
end

-- The host broker chooses these calls and supplies its actual RPC channel ID. None of this native
-- RPC endpoint is granted to Pi; untrusted clients can invoke only the broker's declared operations.
_G.__piAsk = frozen({
	bind = function(channel, launch_id, cwd, session_id)
		local host = hosts[launch_id]
		return host ~= nil and host.bind(channel, cwd, session_id) or false
	end,
	acknowledge = function(channel, launch_id, payload)
		local host = hosts[launch_id]
		return host ~= nil and host.acknowledge(channel, payload) or false
	end,
	close = function(channel, launch_id)
		local host = hosts[launch_id]
		return host ~= nil and host.close(channel) or false
	end,
})

return frozen({ start = start })
