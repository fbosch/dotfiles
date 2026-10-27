local M = {}
local uv = vim.uv
local MAX_FRAME = 64 * 1024
local active
local next_channel = 0

local function only_keys(value, keys)
	if type(value) ~= "table" then
		return false
	end
	for key in pairs(value) do
		if not keys[key] then
			return false
		end
	end
	return true
end

local function close_handle(handle)
	if not handle:is_closing() then
		handle:close()
	end
end

function M.close(launch_id)
	local server = active
	if server == nil or (launch_id ~= nil and server.launch_id ~= launch_id) then
		return
	end
	active = nil
	for _, client in pairs(server.clients) do
		client.close()
	end
	close_handle(server.listener)
	uv.fs_unlink(server.path)
	uv.fs_rmdir(server.directory)
end

function M.send(channel, request)
	local client = active and active.clients[channel]
	if client == nil or not client.bound then
		return false
	end
	return client.send({ type = "prompt", request = request })
end

function M.open(launch_id, cwd, callbacks)
	assert(type(launch_id) == "string" and #launch_id == 32 and launch_id:match("^[a-f0-9]+$"), "invalid launch ID")
	assert(active == nil, "Pi Ask broker already open")
	local runtime = assert(uv.fs_realpath(vim.env.XDG_RUNTIME_DIR or uv.os_tmpdir()))
	local root = runtime .. "/pi-ask-" .. uv.getuid()
	local stat = uv.fs_lstat(root)
	if stat == nil then
		assert(uv.fs_mkdir(root, 448))
		stat = assert(uv.fs_lstat(root))
	end
	assert(stat.type == "directory" and stat.uid == uv.getuid() and stat.mode % 512 == 448, "unsafe Pi Ask directory")
	local directory = root .. "/" .. launch_id
	assert(uv.fs_mkdir(directory, 448))
	local path = directory .. "/broker.sock"
	local listener = uv.new_pipe(false)
	local server = { listener = listener, directory = directory, path = path, launch_id = launch_id, clients = {} }
	local ok, err = pcall(function()
		assert(listener:bind(path))
		assert(uv.fs_chmod(path, 384))
		assert(listener:listen(4, function(listen_error)
			if listen_error or active ~= server then
				return
			end
			local stream = uv.new_pipe(false)
			if not listener:accept(stream) then
				close_handle(stream)
				return
			end
			if vim.tbl_count(server.clients) >= 4 then
				close_handle(stream)
				return
			end
			next_channel = next_channel + 1
			local channel = next_channel
			local timer = uv.new_timer()
			local client = { bound = false }
			local buffer, queued, closed = "", 0, false
			client.close = function()
				if closed then
					return
				end
				closed = true
				server.clients[channel] = nil
				close_handle(timer)
				close_handle(stream)
				vim.schedule(function()
					callbacks.disconnect(channel)
					if server.controller == client then
						server.controller = nil
						if active == server then
							for _, candidate in pairs(server.clients) do
								if candidate.pendingBind ~= nil then
									local ok, accepted = pcall(candidate.bind, candidate.pendingBind)
									if not ok or not accepted then
										candidate.close()
									end
									if server.controller ~= nil then
										break
									end
								end
							end
						end
					end
				end)
			end
			client.send = function(message)
				if closed then
					return false
				end
				local encoded = vim.json.encode(message) .. "\n"
				if #encoded > MAX_FRAME or queued + #encoded > 2 * MAX_FRAME then
					client.close()
					return false
				end
				queued = queued + #encoded
				local written = stream:write(encoded, function(write_error)
					queued = queued - #encoded
					if write_error then
						client.close()
					end
				end)
				if not written then
					client.close()
					return false
				end
				return true
			end
			server.clients[channel] = client
			-- Bound resource use; peers within one sandbox can still interfere with their own PiAsk channel.
			timer:start(5000, 0, client.close)
			-- Session replacement waits for host-observed EOF, never a client-supplied replacement flag.
			client.bind = function(message)
				if server.controller ~= nil then
					client.pendingBind = message
					return true
				end
				local identity = callbacks.bind(channel, message)
				if type(identity) ~= "table" then
					return false
				end
				server.controller = client
				client.pendingBind = nil
				client.bound = true
				timer:stop()
				return client.send({ type = "bound", binding = identity })
			end
			local function receive(message)
				if not client.bound then
					if client.pendingBind ~= nil then
						return false
					end
					if
						not only_keys(message, {
							type = true,
							version = true,
							launchId = true,
							sessionId = true,
							cwd = true,
						})
						or message.type ~= "bind"
						or message.version ~= 1
						or message.launchId ~= launch_id
						or type(message.sessionId) ~= "string"
						or #message.sessionId > 128
						or type(message.cwd) ~= "string"
						or message.cwd ~= cwd
					then
						return false
					end
					return client.bind(message)
				end
				if not only_keys(message, { type = true, payload = true }) or message.type ~= "ack" then
					return false
				end
				return callbacks.ack(message.payload, channel)
			end
			local on_read
			on_read = function(read_error, chunk)
				stream:read_stop()
				if read_error or chunk == nil or #buffer + #chunk > MAX_FRAME then
					client.close()
					return
				end
				buffer = buffer .. chunk
				-- Pause reads while scheduled work owns the buffer: untrusted peers cannot queue unbounded callbacks.
				vim.schedule(function()
					if closed or active ~= server then
						return
					end
					local frames = 0
					while true do
						local newline = buffer:find("\n", 1, true)
						if newline == nil then
							break
						end
						frames = frames + 1
						local line = buffer:sub(1, newline - 1)
						buffer = buffer:sub(newline + 1)
						local decoded, message = pcall(vim.json.decode, line)
						local handled, accepted = false, false
						if decoded and frames <= 32 then
							handled, accepted = pcall(receive, message)
						end
						if not handled or accepted ~= true then
							client.close()
							return
						end
					end
					stream:read_start(on_read)
				end)
			end
			stream:read_start(on_read)
		end))
	end)
	if not ok then
		close_handle(listener)
		uv.fs_unlink(path)
		uv.fs_rmdir(directory)
		error(err)
	end
	active = server
	return path
end

return M
