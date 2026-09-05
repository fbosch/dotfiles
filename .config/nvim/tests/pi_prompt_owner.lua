local repo_root = assert(vim.env.REPO_ROOT)
local bridge = require("plugins.ai.pi.bridge")
local module_names =
	{ "plugins.ai.pi", "plugins.ai.pi.prompt", "utils.session", "config.direnv", "snacks", "snacks.terminal" }

local function scenario(name, run)
	local saved_modules = {}
	for _, key in ipairs(module_names) do
		saved_modules[key] = package.loaded[key]
		package.loaded[key] = nil
	end
	local original_input, original_notify = vim.ui.input, vim.notify
	local original_rpcnotify, original_defer = vim.rpcnotify, vim.defer_fn
	local original_cwd, original_window = vim.fn.getcwd(), vim.api.nvim_get_current_win()
	local original_agent_dir, original_session_dir = vim.env.PI_CODING_AGENT_DIR, vim.env.PI_CODING_AGENT_SESSION_DIR
	local agent_dir = vim.fn.tempname()
	local session_dir = agent_dir .. "/sessions"
	vim.fn.mkdir(session_dir, "p")
	vim.env.PI_CODING_AGENT_DIR, vim.env.PI_CODING_AGENT_SESSION_DIR = agent_dir, session_dir
	vim.cmd.cd(repo_root)
	local session = dofile(repo_root .. "/.config/nvim/lua/utils/session.lua")
	local owner = { cwd = repo_root, metadata_path = vim.fn.tempname(), specifier = "prompt-owner" }
	session.set_current(owner)
	session.set_metadata({}, owner)
	package.loaded["utils.session"] = session
	package.loaded["config.direnv"] = {
		synchronize = function()
			return true
		end,
	}
	package.loaded["snacks"] = { config = {
		get = function()
			return { enabled = false }
		end,
	} }

	local f =
		{ requests = {}, notices = {}, timers = {}, terminals = {}, inputs = {}, owner = owner, session = session }
	f.session_dir = session_dir
	f.source = vim.api.nvim_create_buf(true, false)
	vim.api.nvim_buf_set_name(f.source, repo_root .. "/pi-owner-fixture.lua")
	vim.api.nvim_buf_set_lines(f.source, 0, -1, false, { "første", "anden" })
	vim.api.nvim_set_current_buf(f.source)
	f.window = vim.api.nvim_get_current_win()
	package.loaded["snacks.terminal"] = {
		open = function(command, options)
			local terminal = {
				buf = vim.api.nvim_create_buf(false, true),
				launch = assert(command:match("PI_NVIM_LAUNCH_ID='([a-f0-9]+)'")),
			}
			function terminal:buf_valid()
				return vim.api.nvim_buf_is_valid(self.buf)
			end
			function terminal:valid()
				return self.win ~= nil and vim.api.nvim_win_is_valid(self.win)
			end
			function terminal:on(event, callback)
				vim.api.nvim_create_autocmd(event, { buffer = self.buf, callback = callback })
			end
			function terminal:show()
				if not self:valid() then
					self.win = vim.api.nvim_open_win(self.buf, false, { split = "below", win = f.window })
				end
				return self
			end
			function terminal:focus()
				vim.api.nvim_set_current_win(self.win)
				return self
			end
			function terminal:toggle()
				if self:valid() then
					vim.api.nvim_win_close(self.win, true)
				else
					self:show()
				end
				return self
			end
			function terminal:close()
				if self:buf_valid() then
					vim.api.nvim_buf_delete(self.buf, { force = true })
				end
				if self:valid() then
					vim.api.nvim_win_close(self.win, true)
				end
				return self
			end
			options.win.on_buf(terminal)
			terminal:show()
			if options.win.enter ~= false then
				terminal:focus()
			end
			table.insert(f.terminals, terminal)
			f.terminal = terminal
			return terminal
		end,
	}
	rawset(vim.ui, "input", function(_, confirm)
		table.insert(f.inputs, confirm)
	end)
	rawset(vim, "notify", function(message)
		table.insert(f.notices, message)
	end)
	rawset(vim, "rpcnotify", function(channel, method, request)
		assert(method == "pi:nvim-prompt/v1")
		if f.fail_send then
			return false
		end
		table.insert(f.requests, { channel = channel, payload = vim.deepcopy(request) })
		return true
	end)
	rawset(vim, "defer_fn", function(callback, delay)
		local timer = { callback = callback, delay = delay, closed = false }
		function timer:is_closing()
			return self.closed
		end
		function timer:stop() end
		function timer:close()
			self.closed = true
		end
		table.insert(f.timers, timer)
		return timer
	end)
	f.pi = require("plugins.ai.pi")
	function f.ask(text)
		vim.api.nvim_set_current_win(f.window)
		assert(f.pi.ask("") == true, "Ask did not open input")
		f.inputs[#f.inputs](text)
	end
	function f.bind(channel, session_id, replacement)
		return bridge.dispatch({
			channelId = channel or 12,
			operation = "bind_session",
			payload = {
				launchId = f.terminal.launch,
				sessionId = session_id or "pi-owner-session",
				replacePending = replacement,
			},
		})
	end
	function f.flush()
		vim.wait(10, function()
			return false
		end)
	end
	function f.ack(overrides, channel)
		local request = f.requests[#f.requests]
		local payload = vim.tbl_extend("force", {
			version = 1,
			requestId = request.payload.requestId,
			launchId = request.payload.launchId,
			sessionId = request.payload.sessionId,
			ownerId = request.payload.ownerId,
			outcome = "accepted",
			state = "idle",
		}, overrides or {})
		return bridge.dispatch({ channelId = channel or request.channel, operation = "prompt_ack", payload = payload })
	end
	function f.disconnect(channel)
		assert(bridge.dispatch({ channelId = channel, operation = "remove_notifications", payload = {} }) == true)
	end
	function f.close()
		vim.api.nvim_exec_autocmds("TermClose", { buffer = f.terminal.buf, data = { status = 0 } })
		assert(session.get_metadata(owner).pi_terminal_open == false, "close did not persist closed metadata")
		assert(not f.terminal:buf_valid(), "successful exit did not close the terminal")
	end
	function f.notice(code)
		assert((f.notices[#f.notices] or ""):find(code, 1, true), "missing failure: " .. code)
	end
	function f.warm()
		f.ask("first æøå")
		assert(type(f.bind()) == "table")
		f.flush()
		assert(#f.requests == 1)
		assert(f.ack() == true)
		vim.api.nvim_set_current_win(f.window)
	end

	local ok, err = xpcall(function()
		run(f)
	end, debug.traceback)
	vim.cmd.cd(repo_root)
	for _, terminal in ipairs(f.terminals) do
		terminal:close()
	end
	f.disconnect(12)
	f.disconnect(14)
	vim.api.nvim_set_current_win(original_window)
	vim.api.nvim_buf_delete(f.source, { force = true })
	vim.fn.delete(owner.metadata_path)
	vim.fn.delete(agent_dir, "rf")
	vim.env.PI_CODING_AGENT_DIR, vim.env.PI_CODING_AGENT_SESSION_DIR = original_agent_dir, original_session_dir
	vim.cmd.cd(original_cwd)
	rawset(vim.ui, "input", original_input)
	rawset(vim, "notify", original_notify)
	rawset(vim, "rpcnotify", original_rpcnotify)
	rawset(vim, "defer_fn", original_defer)
	for _, key in ipairs(module_names) do
		package.loaded[key] = saved_modules[key]
	end
	assert(ok, name .. ": " .. tostring(err))
end

scenario("cancel and invalid input never launch", function(f)
	for _, text in ipairs({ "", " \n\t", string.char(0xFF), "nul\0text", string.rep("a", 16385) }) do
		f.ask(text)
	end
	f.ask(nil)
	assert(#f.terminals == 0 and #f.requests == 0)
end)

scenario("cold Ask waits for binding and accepted acknowledgement", function(f)
	f.ask("/review æøå 🚀")
	assert(#f.terminals == 1 and #f.requests == 0)
	assert(vim.api.nvim_get_current_win() == f.window)
	assert(f.pi.ask("") == false and #f.inputs == 1)
	f.notice("PI_BUSY")
	-- An inspection connection may disappear before this terminal has a channel.
	f.disconnect(99)
	assert(type(f.bind()) == "table")
	f.flush()
	assert(#f.requests == 1 and f.requests[1].payload.text == "/review æøå 🚀")
	assert(vim.api.nvim_get_current_win() == f.window)
	assert(f.ack({ outcome = "duplicate", code = "PI_REQUEST_PENDING" }) == true)
	assert(f.pi.ask("") == false)
	assert(f.ack() == true)
	assert(vim.api.nvim_get_current_buf() == f.terminal.buf)
	vim.api.nvim_set_current_win(f.window)
	assert(f.ack() == false and vim.api.nvim_get_current_win() == f.window)
end)

scenario("manual start and toggle reuse one bound terminal", function(f)
	f.pi.start()
	assert(type(f.bind()) == "table")
	f.flush()
	f.pi.toggle()
	f.pi.toggle()
	f.ask("warm")
	assert(vim.api.nvim_get_current_win() == f.window, "warm Ask focused before acknowledgement")
	assert(#f.terminals == 1 and #f.requests == 1)
	assert(f.ack() == true)
	f.ask("again")
	assert(f.requests[2].payload.sequence == 2 and #f.terminals == 1)
end)

scenario("confirmation rechecks pending and uncertain delivery", function(f)
	f.warm()
	assert(f.pi.ask("") == true)
	local first = f.inputs[#f.inputs]
	assert(f.pi.ask("") == true)
	local second = f.inputs[#f.inputs]
	first("in flight")
	second("must not queue")
	assert(#f.requests == 2)
	f.notice("PI_BUSY")
	f.timers[#f.timers].callback()
	second("must not retry")
	f.notice("PI_DELIVERY_UNKNOWN")
	assert(#f.requests == 2)
end)

scenario("mismatched acknowledgements preserve pending delivery", function(f)
	f.warm()
	f.ask("pending")
	for _, overrides in ipairs({
		{ requestId = "other" },
		{ sessionId = "other" },
		{ ownerId = "other" },
		{ launchId = string.rep("a", 32) },
		{ version = 2 },
		{ state = "bad" },
		{ outcome = "bad" },
		{ extra = true },
		{ outcome = "rejected" },
		{ code = "PI_BUSY" },
	}) do
		assert(f.ack(overrides) == false)
	end
	assert(f.ack({}, 99) == false)
	assert(vim.api.nvim_get_current_win() == f.window and #f.requests == 2)
	assert(f.ack({ outcome = "duplicate" }) == true)
	assert(vim.api.nvim_get_current_buf() == f.terminal.buf)
end)

scenario("rejected acknowledgement does not focus or retry", function(f)
	f.warm()
	f.ask("busy Pi")
	assert(f.ack({ outcome = "rejected", code = "PI_BUSY" }) == true)
	f.notice("PI_BUSY")
	assert(vim.api.nvim_get_current_win() == f.window and #f.requests == 2)
	f.ask("explicit next request")
	assert(#f.requests == 3)
end)

scenario("unrelated cleanup does not cancel an awaiting acknowledgement", function(f)
	f.warm()
	f.ask("pending")
	f.disconnect(99)
	assert(f.ack() == true and #f.requests == 2)
end)

scenario("disconnect after send retires ingress until close", function(f)
	f.warm()
	f.ask("pending")
	f.disconnect(12)
	f.notice("PI_DELIVERY_UNKNOWN")
	assert(f.pi.ask("") == false)
	assert(f.ack() == false)
	assert(type(f.bind(14)) == "table")
	f.flush()
	assert(f.pi.ask("") == false and #f.requests == 2)
	f.close()
	f.ask("after restart")
	assert(type(f.bind(14, "fresh")) == "table")
	f.flush()
	assert(#f.requests == 3 and f.requests[3].payload.sequence == 1)
end)

scenario("ack timeout locks ingress and ignores late callbacks", function(f)
	f.warm()
	f.ask("pending")
	local deadline = f.timers[#f.timers]
	assert(deadline.delay == 10000)
	deadline.callback()
	f.notice("PI_ACK_TIMEOUT")
	local inputs = #f.inputs
	assert(f.pi.ask("") == false and #f.inputs == inputs)
	assert(f.ack() == false)
	f.close()
	f.ask("new launch")
	deadline.callback()
	assert(type(f.bind(14, "fresh")) == "table")
	f.flush()
	assert(#f.requests == 3 and f.requests[3].payload.sequence == 1)
end)

scenario("startup timeout cancels without sending", function(f)
	f.ask("not ready")
	f.timers[#f.timers].callback()
	f.notice("PI_SESSION_NOT_READY")
	assert(type(f.bind()) == "table")
	f.flush()
	assert(#f.requests == 0)
	f.ask("explicit retry")
	assert(#f.requests == 1)
end)

scenario("queued bind cannot revive a closed or disconnected launch", function(f)
	f.ask("cold")
	assert(type(f.bind()) == "table")
	f.disconnect(12)
	f.flush()
	assert(#f.requests == 0)
	f.notice("PI_DISCONNECTED")
	f.close()
	f.ask("another cold")
	assert(type(f.bind(14, "fresh")) == "table")
	f.close()
	f.flush()
	assert(#f.requests == 0)
end)

scenario("session replacement cancels both queued and sent prompts", function(f)
	f.ask("queued")
	assert(type(f.bind()) == "table")
	assert(type(f.bind(12, "replacement", true)) == "table")
	f.flush()
	assert(#f.requests == 0)
	f.notice("PI_SESSION_MISMATCH")
	f.ask("sent")
	assert(#f.requests == 1)
	assert(type(f.bind(12, "replacement-two", true)) == "table")
	f.flush()
	f.notice("PI_DELIVERY_UNKNOWN")
	assert(f.pi.ask("") == false and #f.requests == 1)
end)

scenario("accepted reply cannot focus after owner or cwd changes", function(f)
	f.warm()
	f.ask("owner changes")
	f.session.set_current({ cwd = repo_root, specifier = "other" })
	assert(f.ack() == false and vim.api.nvim_get_current_win() == f.window)
	f.session.set_current(f.owner)
	f.ask("cwd changes")
	vim.cmd.cd(vim.fn.fnamemodify(repo_root, ":h"))
	assert(f.ack() == false and vim.api.nvim_get_current_win() == f.window)
	vim.cmd.cd(repo_root)
	assert(f.ack() == false and #f.requests == 3)
end)

scenario("restored terminal serves Ask and rejects a different cold binding", function(f)
	vim.fn.writefile({
		vim.json.encode({
			type = "session",
			version = 3,
			id = "pi-saved",
			cwd = repo_root,
			timestamp = "2026-09-05T00:00:00.000Z",
		}),
	}, f.session_dir .. "/fixture_pi-saved.jsonl")
	f.session.set_metadata({ pi_session_id = "pi-saved", pi_terminal_open = true }, f.owner)
	f.pi.setup()
	vim.api.nvim_exec_autocmds("User", { pattern = "SessionLoadPost" })
	assert(#f.terminals == 1, "session restoration did not open the saved terminal")
	assert(type(f.bind(12, "pi-saved")) == "table")
	f.flush()
	f.ask("restored warm Ask")
	assert(#f.terminals == 1 and #f.requests == 1 and f.requests[1].payload.sessionId == "pi-saved")
	assert(f.ack() == true)
	f.close()
	f.ask("restored cold Ask")
	assert(vim.api.nvim_get_current_win() == f.window, "cold restoration focused before acknowledgement")
	assert(#f.terminals == 2 and #f.requests == 1)
	assert(type(f.bind(12, "wrong-session")) == "table")
	f.flush()
	assert(#f.requests == 1, "cold restoration sent to a different saved session")
	f.notice("PI_SESSION_MISMATCH")
end)

scenario("RPC send failure does not silently queue", function(f)
	f.warm()
	f.fail_send = true
	f.ask("failed send")
	f.notice("PI_DISCONNECTED")
	assert(#f.requests == 1 and vim.api.nvim_get_current_win() == f.window)
end)
