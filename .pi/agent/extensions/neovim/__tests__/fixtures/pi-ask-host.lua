local uv = vim.uv
local METHOD = "pi:nvim-prompt/v1"

local function frozen(values)
	return setmetatable({}, {
		__index = values,
		__newindex = function()
			error("test Pi Ask host is immutable", 2)
		end,
		__metatable = false,
	})
end

local function encode(value)
	return vim.json.encode(value) .. "\n"
end

local function start(options)
	local root = vim.env.PI_ASK_FIXTURE_ROOT or vim.fn.tempname()
	vim.fn.mkdir(root, "p")
	local path = root .. "/pi-ask-" .. tostring(vim.fn.getpid()) .. ".sock"
	local server = uv.new_pipe(false)
	assert(server:bind(path))
	local peer
	local sequence = 0
	local stopped = false

	local function close_peer(target, notify)
		if target == nil or target.closed then
			return
		end
		target.closed = true
		if peer == target then
			peer = nil
		end
		if notify and target.channelId ~= nil then
			local channel_id = target.channelId
			vim.schedule(function()
				pcall(options.closed, channel_id)
			end)
		end
	end

	local function send(target, value)
		if target == nil or target.closed then
			return false
		end
		local ok = pcall(target.pipe.write, target.pipe, encode(value))
		return ok
	end

	local function handle(target, value)
		if value.type == "bind" then
			sequence = sequence + 1
			target.channelId = sequence
			local binding = options.bind({
				channelId = sequence,
				editorPid = vim.fn.getpid(),
				launchId = value.launchId,
				cwd = value.cwd,
				sessionId = value.sessionId,
				replacePending = true,
			})
			if type(binding) ~= "table" then
				send(target, { version = 1, type = "error", code = "bind-rejected" })
				close_peer(target, false)
				return
			end
			target.bound = true
			send(target, { version = 1, type = "bound", binding = binding })
		elseif value.type == "ack" and target.bound then
			pcall(options.acknowledge, value.payload, target.channelId)
		elseif value.type == "close" then
			close_peer(target, true)
		else
			close_peer(target, true)
		end
	end

	server:listen(16, function(err)
		if stopped or err then
			return
		end
		local pipe = uv.new_pipe(false)
		assert(server:accept(pipe))
		if peer ~= nil then
			local rejected = { pipe = pipe, closed = false }
			send(rejected, { version = 1, type = "error", code = "bind-rejected" })
			close_peer(rejected, false)
			return
		end
		local target = { pipe = pipe, buffer = "", closed = false }
		peer = target
		pipe:read_start(function(read_error, chunk)
			if read_error or chunk == nil then
				vim.schedule(function()
					close_peer(target, true)
				end)
				return
			end
			vim.schedule(function()
				if target.closed then
					return
				end
				target.buffer = target.buffer .. chunk
				while true do
					local newline = target.buffer:find("\n", 1, true)
					if not newline then
						return
					end
					local line = target.buffer:sub(1, newline - 1)
					target.buffer = target.buffer:sub(newline + 1)
					local ok, value = pcall(vim.json.decode, line)
					if not ok then
						close_peer(target, true)
						return
					end
					handle(target, value)
					if target.closed then
						return
					end
				end
			end)
		end)
	end)

	local api = {}
	function api.is_open(channel_id)
		return not stopped and (peer == nil or (not peer.closed and peer.channelId == channel_id))
	end
	function api.notify(channel_id, method, request)
		if method ~= METHOD then
			return false
		end
		if peer ~= nil and peer.bound and peer.channelId == channel_id then
			return send(peer, { version = 1, type = "prompt", request = request })
		end
		local hook = rawget(_G, "pi_test_ask_notify")
		if type(hook) == "function" then
			return hook(channel_id, method, request)
		end
		return true
	end
	function api.close(channel_id)
		if peer ~= nil and peer.channelId == channel_id then
			close_peer(peer, true)
		end
		return true
	end
	function api.stop()
		if stopped then
			return
		end
		stopped = true
		close_peer(peer, true)
		if not server:is_closing() then
			server:close()
		end
		uv.fs_unlink(path)
	end
	api.socketPath = path
	return frozen(api)
end

return frozen({ start = start })
