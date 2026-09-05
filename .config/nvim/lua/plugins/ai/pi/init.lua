local pi_bridge = require("plugins.ai.pi.bridge")
local pi_session = require("plugins.ai.pi.session")
local path_loader = require("config.direnv")
local session = require("utils.session")

local M = {}

local terminal_instance
local terminal_session_id
local terminal_owner
local terminal_owner_id
local terminal_launch_id
local terminal_channel_id
local terminal_bound = false
local launch_sequence = 0
local prompt_active_binding
local prompt_sequence_launch_id
local prompt_uncertain_launch_id
local prompt_next_sequence = 1
local prompt_pending
local bound, terminal_closed, session_replaced, binding_unavailable
local source_window
local source_buffer
local terminal_options = {
	win = {
		on_buf = function(terminal)
			vim.b[terminal.buf].is_pi_terminal = true
		end,
		position = "left",
		width = 100,
	},
}
local max_context_lines = 500
local max_context_bytes = 32 * 1024

local function clear_terminal_state()
	local closed_session_id = terminal_session_id
	local closed_owner = terminal_owner
	local closed_launch_id = terminal_launch_id
	terminal_instance = nil
	terminal_session_id = nil
	terminal_owner = nil
	terminal_owner_id = nil
	terminal_launch_id = nil
	terminal_channel_id = nil
	terminal_bound = false
	terminal_closed(closed_launch_id)
	if closed_owner ~= nil then
		session.set_pi_terminal_state(closed_session_id, false, closed_owner)
	end
end

local function current_terminal()
	if terminal_instance ~= nil and terminal_instance:buf_valid() then
		return terminal_instance
	end

	if terminal_instance ~= nil then
		clear_terminal_state()
	end
	return nil
end

local function owned_terminal(owner)
	local terminal = current_terminal()
	if terminal ~= nil and terminal_owner ~= owner then
		vim.notify(
			"Pi terminal belongs to another Neovim session; close it before starting Pi here.",
			vim.log.levels.WARN
		)
		return nil, false
	end
	return terminal, true
end

local function return_to_editor()
	if vim.api.nvim_get_mode().mode:sub(1, 1) == "t" then
		vim.cmd("stopinsert")
	end
	if
		source_window ~= nil
		and source_buffer ~= nil
		and vim.api.nvim_win_is_valid(source_window)
		and vim.api.nvim_win_get_buf(source_window) == source_buffer
	then
		vim.api.nvim_set_current_win(source_window)
		return
	end
	vim.cmd("wincmd p")
end

local function configure_terminal(terminal)
	local options = { buffer = terminal.buf, silent = true }
	vim.keymap.set(
		"t",
		"<C-g>",
		return_to_editor,
		vim.tbl_extend("force", options, {
			desc = "Return to editor",
		})
	)
	vim.keymap.set(
		{ "n", "t" },
		"<C-\\>",
		return_to_editor,
		vim.tbl_extend("force", options, {
			desc = "Toggle Pi focus",
		})
	)
	vim.keymap.set(
		"n",
		"q",
		return_to_editor,
		vim.tbl_extend("force", options, {
			desc = "Exit Pi terminal",
		})
	)
	vim.keymap.set("n", "<C-h>", "<C-w>h", options)
	vim.keymap.set("n", "<C-j>", "<C-w>j", options)
	vim.keymap.set("n", "<C-k>", "<C-w>k", options)
	vim.keymap.set("n", "<C-l>", "<C-w>l", options)
end

local function source_context()
	local buffer = vim.api.nvim_get_current_buf()
	local options = vim.bo[buffer]
	local name = vim.api.nvim_buf_get_name(buffer)
	if
		name == ""
		or options.buftype ~= ""
		or options.filetype == "opencode"
		or options.filetype == "opencode_terminal"
	then
		return nil
	end

	local cursor = vim.api.nvim_win_get_cursor(0)
	local mode = vim.api.nvim_get_mode().mode
	local selection = vim.NIL
	if mode == "v" or mode == "V" or mode == string.char(22) then
		local anchor = vim.fn.getpos("v")
		local current = vim.fn.getpos(".")
		local lines = vim.fn.getregion(anchor, current, { type = mode })
		local bytes = math.max(0, #lines - 1)
		for _, line in ipairs(lines) do
			bytes = bytes + #line
		end
		if #lines <= max_context_lines and bytes <= max_context_bytes then
			selection = {
				mode = mode,
				anchor = { line = anchor[2], column = anchor[3] },
				cursor = { line = current[2], column = current[3] },
				lines = lines,
			}
		end
	end

	return {
		pid = vim.fn.getpid(),
		cwd = vim.fn.getcwd(),
		mode = mode,
		buffer = {
			number = buffer,
			name = name,
			loaded = vim.api.nvim_buf_is_loaded(buffer),
			filetype = options.filetype,
			buftype = options.buftype,
			modified = options.modified,
		},
		cursor = { line = math.max(cursor[1], 1), column = math.max(cursor[2] + 1, 1) },
		selection = selection,
	}
end

local function record_source_context()
	local context = source_context()
	if context ~= nil then
		source_window = vim.api.nvim_get_current_win()
		source_buffer = context.buffer.number
		pi_bridge.record_source_context(context)
	end
end

local function next_launch_id()
	launch_sequence = launch_sequence + 1
	local seed = table.concat({
		tostring(vim.fn.getpid()),
		tostring(vim.uv.hrtime()),
		tostring(launch_sequence),
		tostring({}),
	}, ":")
	return vim.fn.sha256(seed):sub(1, 32)
end

local function owner_id(owner)
	if type(owner) == "table" and type(owner.specifier) == "string" and owner.specifier ~= "" then
		return owner.specifier
	end
	return "nvim:" .. tostring(vim.fn.getpid())
end

local function canonical_path(path)
	return vim.uv.fs_realpath(path) or vim.fs.normalize(path)
end

local function prepare_launch(cwd, owner)
	local expected_cwd = canonical_path(cwd)
	local socket = vim.v.servername
	if expected_cwd == nil or canonical_path(vim.fn.getcwd()) ~= expected_cwd then
		return nil, "worktree"
	end

	local ok, result = pcall(path_loader.synchronize, expected_cwd)
	if not ok or (result ~= true and (type(result) ~= "table" or result.ok ~= true)) then
		return nil, "environment", ok and result or nil
	end
	if
		canonical_path(vim.fn.getcwd()) ~= expected_cwd
		or vim.v.servername ~= socket
		or session.get_current(vim.fn.getcwd()) ~= owner
	then
		return nil, "changed"
	end
	return socket
end

local function launch_command(session_flag, session_id, session_dir, socket, launch_id)
	if type(socket) ~= "string" or socket == "" then
		error("pi requires a Neovim RPC socket")
	end
	if type(launch_id) ~= "string" or launch_id:match("^[a-f0-9]+$") == nil or #launch_id ~= 32 then
		error("pi requires a valid Neovim launch ID")
	end

	local environment = "PI_NVIM_LAUNCH_ID="
		.. vim.fn.shellescape(launch_id)
		.. " "
		.. "PI_NVIM_SOCKET="
		.. vim.fn.shellescape(socket)
		.. " "
	if vim.env.HERDR_ENV == "1" then
		-- Snacks launches Pi directly, bypassing the Fish wrapper used by Herdr shells.
		environment = "PI_IMAGE_PROTOCOL=none " .. environment
	end
	local pane_id = vim.env.HERDR_PANE_ID
	if vim.env.HERDR_ENV == "1" and type(pane_id) == "string" and pane_id ~= "" then
		-- Herdr accepts official Pi lifecycle reports only when Pi owns the pane process.
		environment = "env -u HERDR_PANE_ID PI_NVIM_HERDR_PANE_ID=" .. vim.fn.shellescape(pane_id) .. " " .. environment
	end

	local command = environment .. "pi"
	if session_dir ~= nil then
		command = command .. " --session-dir " .. vim.fn.shellescape(session_dir)
	end
	if session_flag == nil or session_id == nil then
		return command
	end
	return command .. " " .. session_flag .. " " .. vim.fn.shellescape(session_id)
end

local function open_terminal(session_flag, session_id, session_dir, cwd, socket, owner, launch_options)
	launch_options = launch_options or {}
	local launch_id = next_launch_id()
	local win_options = vim.deepcopy(terminal_options.win)
	if launch_options.focus == false then
		win_options.enter = false
	end
	local options = {
		cwd = cwd,
		win = win_options,
		-- Snacks auto-close deletes its event group before our cleanup can run.
		auto_close = false,
	}
	local terminal = require("snacks.terminal").open(
		launch_command(session_flag, session_id, session_dir, socket, launch_id),
		options
	)
	terminal_instance = terminal
	terminal_session_id = session_id
	terminal_owner = owner
	terminal_owner_id = owner_id(owner)
	terminal_launch_id = launch_id
	terminal_channel_id = nil
	terminal_bound = false
	configure_terminal(terminal)
	local function clear_terminal()
		if terminal_instance == terminal then
			clear_terminal_state()
		end
	end
	terminal:on("TermClose", function()
		local status = vim.v.event.status
		clear_terminal()
		if status ~= nil and status ~= 0 then
			require("snacks").notify.error("Terminal exited with code " .. status .. ".\nCheck for any errors.")
			return
		end
		terminal:close()
		vim.cmd.checktime()
	end, { buf = true })
	terminal:on("BufWipeout", clear_terminal, { buf = true })
	local focus_window = launch_options.focus_window
	if launch_options.focus == false and focus_window ~= nil and vim.api.nvim_win_is_valid(focus_window) then
		vim.api.nvim_set_current_win(focus_window)
	end
	return terminal
end

local function save_terminal_state()
	local nvim_session = session.get_current()
	if nvim_session == nil then
		return
	end

	local terminal = current_terminal()
	local is_open = terminal ~= nil and terminal_owner == nvim_session and terminal:valid()
	if is_open and terminal_session_id == nil then
		session.set_pi_terminal_state(nil, false, nvim_session)
		return
	end
	session.set_pi_terminal_state(is_open and terminal_session_id or nil, is_open, nvim_session)
end

local function notify_restore_failure(reason)
	local messages = {
		ambiguous = "multiple files have the saved session ID",
		invalid_id = "the saved session ID is invalid",
		invalid_session = "the saved session file is invalid",
		missing = "the exact saved session is unavailable",
		open_failed = "the Pi terminal could not be opened",
		search_limit = "the session search limit was reached",
		wrong_worktree = "the saved session belongs to another worktree",
	}
	vim.notify("Pi session was not restored: " .. messages[reason] .. ".", vim.log.levels.WARN)
end

local function notify_launch_environment_failure(result)
	local status = type(result) == "table" and result.status or "unavailable"
	local message = "Project environment is unavailable; check direnv and `.envrc` before starting Pi."
	if type(path_loader.failure_message) == "function" then
		message = path_loader.failure_message(status)
	end
	vim.notify("Pi launch blocked: " .. message, vim.log.levels.ERROR)
end

local function notify_launch_preparation_failure(reason, result)
	if reason == "environment" then
		notify_launch_environment_failure(result)
	elseif reason == "worktree" then
		vim.notify("Pi launch cancelled: the current worktree changed.", vim.log.levels.WARN)
	else
		vim.notify("Pi launch cancelled: the Neovim session or RPC socket changed.", vim.log.levels.WARN)
	end
end

local function open_fresh_session(nvim_session, socket, launch_options)
	local ok, terminal = pcall(open_terminal, nil, nil, nil, nvim_session.cwd, socket, nvim_session, launch_options)
	if not ok then
		notify_restore_failure("open_failed")
		return nil
	end
	return terminal
end

local function resume_saved_session(nvim_session, launch_options, prepared_socket)
	local session_id = session.get_metadata(nvim_session).pi_session_id
	if not session.is_valid_pi_session_id(session_id) then
		notify_restore_failure("invalid_id")
		return nil
	end

	local socket = prepared_socket
	if socket == nil then
		local reason, result
		socket, reason, result = prepare_launch(nvim_session.cwd, nvim_session)
		if socket == nil then
			if reason == "worktree" then
				notify_restore_failure("wrong_worktree")
			else
				notify_launch_preparation_failure(reason, result)
			end
			return nil
		end
	end
	if
		canonical_path(vim.fn.getcwd()) ~= canonical_path(nvim_session.cwd)
		or session.get_current(vim.fn.getcwd()) ~= nvim_session
		or vim.v.servername ~= socket
	then
		notify_restore_failure("wrong_worktree")
		return nil
	end
	if vim.fn.executable("pi") ~= 1 then
		vim.notify("Pi session was not restored: pi executable not found.", vim.log.levels.WARN)
		return nil
	end

	local existing = current_terminal()
	if existing ~= nil then
		if terminal_owner ~= nvim_session then
			vim.notify("Pi session was not restored: another Pi terminal is already open.", vim.log.levels.WARN)
		end
		return nil
	end

	local found, reason = pi_session.find_exact(session_id, nvim_session.cwd)
	if found == nil and reason ~= "missing" then
		notify_restore_failure(reason)
		return nil
	end
	if session.get_current(vim.fn.getcwd()) ~= nvim_session or vim.v.servername ~= socket then
		notify_restore_failure("wrong_worktree")
		return nil
	end
	if found == nil then
		local terminal = open_fresh_session(nvim_session, socket, launch_options)
		if terminal ~= nil then
			vim.notify("Saved Pi session is unavailable; started a new Pi session.", vim.log.levels.INFO)
		end
		return terminal
	end

	local ok, terminal =
		pcall(open_terminal, "--session", session_id, found.directory, found.cwd, socket, nvim_session, launch_options)
	if not ok then
		notify_restore_failure("open_failed")
		return nil
	end
	return terminal
end

function M.restore()
	local nvim_session = session.get_current()
	if nvim_session == nil then
		return false
	end

	local metadata = session.get_metadata(nvim_session)
	if metadata.pi_terminal_open ~= true then
		return false
	end
	return resume_saved_session(nvim_session) ~= nil
end

function M.bind_session(binding)
	local session_id = type(binding) == "table" and binding.sessionId or binding
	if not session.is_valid_pi_session_id(session_id) then
		return false
	end
	local terminal = current_terminal()
	local owner = session.get_current(vim.fn.getcwd())
	if terminal == nil or owner == nil or terminal_owner ~= owner then
		return false
	end

	if type(binding) == "table" and binding.launchId ~= nil then
		local binding_cwd = type(binding.cwd) == "string" and canonical_path(binding.cwd) or nil
		local owner_cwd = canonical_path(owner.cwd)
		if
			type(binding.launchId) ~= "string"
			or binding.launchId ~= terminal_launch_id
			or type(binding.channelId) ~= "number"
			or binding.channelId < 1
			or binding.channelId % 1 ~= 0
			or binding.editorPid ~= vim.fn.getpid()
			or (binding.replacePending ~= nil and type(binding.replacePending) ~= "boolean")
			or binding_cwd == nil
			or owner_cwd == nil
			or binding_cwd ~= owner_cwd
		then
			return false
		end
		if binding.replacePending then
			session_replaced(binding.launchId)
		end
	end

	if not session.set_pi_terminal_state(session_id, true, owner) then
		return false
	end
	terminal_session_id = session_id
	if type(binding) ~= "table" or binding.launchId == nil then
		terminal_bound = false
		terminal_channel_id = nil
		binding_unavailable(terminal_launch_id)
		return true
	end

	terminal_channel_id = binding.channelId
	terminal_bound = true
	local identity = {
		version = 1,
		channelId = terminal_channel_id,
		cwd = canonical_path(owner.cwd),
		editorPid = vim.fn.getpid(),
		launchId = terminal_launch_id,
		ownerId = terminal_owner_id,
		sessionId = terminal_session_id,
	}
	vim.schedule(function()
		-- A queued bind may outlive a close or replacement; never revive stale ingress.
		if
			current_terminal() == terminal
			and terminal_bound
			and terminal_launch_id == identity.launchId
			and terminal_channel_id == identity.channelId
			and terminal_session_id == identity.sessionId
		then
			bound(identity)
		end
	end)
	return identity
end

function M.setup()
	local group = vim.api.nvim_create_augroup("PiSessionPersistence", { clear = true })
	vim.api.nvim_create_autocmd("User", {
		group = group,
		pattern = "SessionLoadPost",
		callback = M.restore,
	})
	vim.api.nvim_create_autocmd("User", {
		group = group,
		pattern = "SessionSavePre",
		callback = save_terminal_state,
	})
end

local function ensure_started(options)
	options = options or {}
	M.setup()

	local cwd = vim.fn.getcwd()
	local owner = session.get_current(cwd)
	local terminal, owned = owned_terminal(owner)
	if not owned then
		return nil
	end
	record_source_context()
	if terminal ~= nil then
		if options.focus ~= false then
			terminal:show():focus()
		end
		return terminal
	end

	local socket, reason, result = prepare_launch(cwd, owner)
	if socket == nil then
		notify_launch_preparation_failure(reason, result)
		return nil
	end
	if vim.fn.executable("pi") ~= 1 then
		vim.notify("pi executable not found", vim.log.levels.ERROR)
		return nil
	end

	if owner ~= nil and session.get_metadata(owner).pi_session_id ~= nil then
		return resume_saved_session(owner, options, socket)
	end
	local launch_cwd = owner ~= nil and owner.cwd or cwd
	return open_terminal(nil, nil, nil, launch_cwd, socket, owner, options)
end

local prompt_messages = {
	PI_ACK_TIMEOUT = "Pi may have received the prompt; inspect Pi, then restart its terminal before submitting again.",
	PI_BUSY = "Wait for the current Pi response or question to finish.",
	PI_CONTEXT_STALE = "The source changed; select it again and reopen Pi Ask.",
	PI_CONTEXT_TOO_LARGE = "The source file path exceeds the 4 KiB limit.",
	PI_CONTEXT_UNAVAILABLE = "Select lines in a named source buffer before using Pi Ask.",
	PI_DELIVERY_UNKNOWN = "Pi may have received the prompt; inspect Pi, then restart its terminal before submitting again.",
	PI_DISCONNECTED = "The bound Pi terminal disconnected.",
	PI_INVALID_REQUEST = "The prompt request was invalid.",
	PI_INVALID_UTF8 = "The prompt is not valid UTF-8.",
	PI_LAUNCH_MISMATCH = "Restart the Pi terminal before using Pi Ask.",
	PI_NO_UI = "Pi Ask requires the interactive Pi terminal.",
	PI_PROMPT_EMPTY = "Enter a prompt before submitting.",
	PI_PROMPT_TOO_LARGE = "The prompt exceeds the 16 KiB limit.",
	PI_RELOAD_REQUIRED = "Restart Neovim to load the updated Pi Ask integration.",
	PI_REQUEST_ID_REUSED = "The prompt request identity was already used.",
	PI_REQUEST_OUT_OF_ORDER = "The prompt request arrived out of order.",
	PI_REQUEST_PENDING = "The prompt request is already being delivered.",
	PI_SESSION_MISMATCH = "The Pi terminal session changed; submit from the current session.",
	PI_SESSION_NOT_READY = "Pi did not finish binding its terminal session.",
	PI_STALE_REQUEST = "The prompt request is stale.",
	PI_UNSUPPORTED = "This Pi version could not accept the prompt.",
	PI_WORKTREE_MISMATCH = "The Pi terminal belongs to another worktree.",
}

function M.prompt_failed(code)
	vim.notify(
		string.format("Pi Ask failed (%s): %s", code, prompt_messages[code] or "The request was rejected."),
		vim.log.levels.WARN
	)
end

local function clear_prompt_pending()
	local pending = prompt_pending
	prompt_pending = nil
	if pending ~= nil and pending.timer ~= nil then
		pcall(function()
			if not pending.timer:is_closing() then
				pending.timer:stop()
				pending.timer:close()
			end
		end)
	end
	return pending
end

local function prompt_identity()
	if not terminal_bound or current_terminal() == nil then
		return nil
	end
	local owner = session.get_current(vim.fn.getcwd())
	if
		owner == nil
		or terminal_owner ~= owner
		or terminal_session_id == nil
		or canonical_path(vim.fn.getcwd()) ~= canonical_path(owner.cwd)
	then
		return nil
	end
	return {
		version = 1,
		channelId = terminal_channel_id,
		cwd = canonical_path(owner.cwd),
		editorPid = vim.fn.getpid(),
		launchId = terminal_launch_id,
		ownerId = terminal_owner_id,
		sessionId = terminal_session_id,
	}
end

local function send_prompt()
	local pending, identity = prompt_pending, prompt_active_binding
	if pending == nil or pending.sent or identity == nil then
		return
	end
	if pending.launch_id ~= identity.launchId then
		clear_prompt_pending()
		M.prompt_failed("PI_LAUNCH_MISMATCH")
		return
	end
	if pending.expected_session_id ~= nil and pending.expected_session_id ~= identity.sessionId then
		clear_prompt_pending()
		M.prompt_failed("PI_SESSION_MISMATCH")
		return
	end
	if canonical_path(vim.fn.getcwd()) ~= identity.cwd then
		clear_prompt_pending()
		M.prompt_failed("PI_WORKTREE_MISMATCH")
		return
	end
	if session.get_current(vim.fn.getcwd()) ~= terminal_owner then
		clear_prompt_pending()
		M.prompt_failed("PI_SESSION_MISMATCH")
		return
	end
	local stale = pi_bridge.validate_prompt_location(pending.location, identity.cwd)
	if stale ~= nil then
		clear_prompt_pending()
		M.prompt_failed(stale)
		return
	end
	local sequence = prompt_next_sequence
	local request = {
		version = 1,
		requestId = string.format("nvim:%s:%d", identity.launchId, sequence),
		sequence = sequence,
		operation = "submit",
		launchId = identity.launchId,
		sessionId = identity.sessionId,
		ownerId = identity.ownerId,
		cwd = identity.cwd,
		editorPid = identity.editorPid,
		text = pending.text,
		context = pending.location and pending.location.context or vim.NIL,
	}
	local ok, encoded = pcall(vim.json.encode, request)
	if not ok or #encoded > 64 * 1024 then
		clear_prompt_pending()
		M.prompt_failed(ok and "PI_PROMPT_TOO_LARGE" or "PI_INVALID_UTF8")
		return
	end
	prompt_next_sequence = sequence + 1
	pending.sequence, pending.request_id, pending.session_id, pending.sent =
		sequence, request.requestId, identity.sessionId, true
	local sent_ok, sent = pcall(vim.rpcnotify, identity.channelId, "pi:nvim-prompt/v1", request)
	if not sent_ok or sent == false then
		if prompt_sequence_launch_id == identity.launchId and prompt_next_sequence == sequence + 1 then
			prompt_next_sequence = sequence
		end
		prompt_active_binding = nil
		clear_prompt_pending()
		M.prompt_failed("PI_DISCONNECTED")
	end
end

bound = function(identity)
	if
		type(identity) ~= "table"
		or identity.version ~= 1
		or type(identity.channelId) ~= "number"
		or type(identity.launchId) ~= "string"
		or type(identity.sessionId) ~= "string"
	then
		return false
	end
	if prompt_pending ~= nil and prompt_pending.sent and prompt_pending.session_id ~= identity.sessionId then
		prompt_uncertain_launch_id = prompt_pending.launch_id
		clear_prompt_pending()
		M.prompt_failed("PI_DELIVERY_UNKNOWN")
	end
	if prompt_sequence_launch_id ~= identity.launchId then
		prompt_sequence_launch_id, prompt_next_sequence, prompt_uncertain_launch_id = identity.launchId, 1, nil
	end
	prompt_active_binding = vim.deepcopy(identity)
	send_prompt()
	return true
end

function M.prompt_available()
	if prompt_uncertain_launch_id ~= nil then
		M.prompt_failed("PI_DELIVERY_UNKNOWN")
		return false
	end
	if prompt_pending ~= nil then
		M.prompt_failed("PI_BUSY")
		return false
	end
	return true
end

function M.submit_prompt(text, location, source_window)
	if not M.prompt_available() then
		return false
	end
	local stale = pi_bridge.validate_prompt_location(location, vim.fn.getcwd())
	if stale ~= nil then
		M.prompt_failed(stale)
		return false
	end
	local terminal = ensure_started({ focus = false, focus_window = source_window })
	if terminal == nil then
		return false
	end
	if terminal_owner == nil or session.get_current(vim.fn.getcwd()) ~= terminal_owner then
		M.prompt_failed("PI_SESSION_NOT_READY")
		return false
	end
	local identity = prompt_identity()
	prompt_pending = {
		expected_session_id = terminal_session_id,
		launch_id = terminal_launch_id,
		location = location,
		text = text,
		sent = false,
	}
	local pending = prompt_pending
	pending.timer = vim.defer_fn(function()
		if prompt_pending ~= pending then
			return
		end
		if pending.sent then
			prompt_uncertain_launch_id, prompt_active_binding = pending.launch_id, nil
		end
		clear_prompt_pending()
		M.prompt_failed(pending.sent and "PI_ACK_TIMEOUT" or "PI_SESSION_NOT_READY")
	end, 10000)
	if identity ~= nil then
		bound(identity)
	end
	return true
end

function M.prompt_acknowledge(payload, channel)
	local pending, identity = prompt_pending, prompt_active_binding
	if
		pending == nil
		or not pending.sent
		or identity == nil
		or type(payload) ~= "table"
		or payload.version ~= 1
		or payload.requestId ~= pending.request_id
		or payload.launchId ~= identity.launchId
		or payload.sessionId ~= identity.sessionId
		or payload.ownerId ~= identity.ownerId
		or channel ~= identity.channelId
	then
		return false
	end
	for key in pairs(payload) do
		if
			key ~= "version"
			and key ~= "requestId"
			and key ~= "launchId"
			and key ~= "sessionId"
			and key ~= "ownerId"
			and key ~= "outcome"
			and key ~= "state"
			and key ~= "code"
		then
			return false
		end
	end
	if payload.outcome ~= "accepted" and payload.outcome ~= "duplicate" and payload.outcome ~= "rejected" then
		return false
	end
	if
		payload.state ~= "starting"
		and payload.state ~= "idle"
		and payload.state ~= "streaming"
		and payload.state ~= "blocked"
		and payload.state ~= "closed"
	then
		return false
	end
	if payload.code ~= nil and (type(payload.code) ~= "string" or prompt_messages[payload.code] == nil) then
		return false
	end
	if
		(payload.outcome == "accepted" and payload.code ~= nil)
		or (payload.outcome == "rejected" and payload.code == nil)
	then
		return false
	end
	if payload.outcome == "duplicate" and payload.code == "PI_REQUEST_PENDING" then
		return true
	end
	clear_prompt_pending()
	if payload.outcome == "accepted" or (payload.outcome == "duplicate" and payload.code == nil) then
		local current_identity = prompt_identity()
		if
			current_identity == nil
			or current_identity.launchId ~= payload.launchId
			or current_identity.channelId ~= channel
			or current_identity.sessionId ~= payload.sessionId
			or current_identity.ownerId ~= payload.ownerId
			or current_identity.cwd ~= identity.cwd
		then
			return false
		end
		terminal_instance:show():focus()
		return true
	end
	if payload.code == "PI_DELIVERY_UNKNOWN" then
		prompt_uncertain_launch_id, prompt_active_binding = payload.launchId, nil
	end
	M.prompt_failed(payload.code or "PI_UNSUPPORTED")
	return true
end

terminal_closed = function(launch_id)
	if prompt_pending ~= nil and prompt_pending.launch_id == launch_id then
		clear_prompt_pending()
		M.prompt_failed("PI_DISCONNECTED")
	end
	if prompt_active_binding ~= nil and prompt_active_binding.launchId == launch_id then
		prompt_active_binding = nil
	end
	if prompt_sequence_launch_id == launch_id then
		prompt_sequence_launch_id, prompt_uncertain_launch_id, prompt_next_sequence = nil, nil, 1
	end
end

function M.prompt_channel_closed(channel)
	-- Other inspection channels cannot retire the terminal's prompt ingress.
	if channel ~= terminal_channel_id then
		return
	end
	terminal_bound = false
	terminal_channel_id = nil
	prompt_active_binding = nil
	if prompt_pending ~= nil then
		local sent = prompt_pending.sent
		if sent then
			prompt_uncertain_launch_id = prompt_pending.launch_id
		end
		clear_prompt_pending()
		M.prompt_failed(sent and "PI_DELIVERY_UNKNOWN" or "PI_DISCONNECTED")
	end
end

session_replaced = function(launch_id)
	if prompt_pending ~= nil and prompt_pending.launch_id == launch_id then
		local sent = prompt_pending.sent
		if sent then
			prompt_uncertain_launch_id = launch_id
		end
		clear_prompt_pending()
		M.prompt_failed(sent and "PI_DELIVERY_UNKNOWN" or "PI_SESSION_MISMATCH")
	end
	if prompt_active_binding ~= nil and prompt_active_binding.launchId == launch_id then
		prompt_active_binding = nil
	end
end

binding_unavailable = function(launch_id)
	if prompt_pending ~= nil and prompt_pending.launch_id == launch_id then
		local sent = prompt_pending.sent
		if sent then
			prompt_uncertain_launch_id = launch_id
		end
		clear_prompt_pending()
		M.prompt_failed(sent and "PI_DELIVERY_UNKNOWN" or "PI_SESSION_NOT_READY")
	end
	if prompt_active_binding ~= nil and prompt_active_binding.launchId == launch_id then
		prompt_active_binding = nil
	end
end

function M.ask(prefill)
	return require("plugins.ai.pi.prompt").open(M, prefill)
end

function M.start()
	return ensure_started({ focus = true })
end

function M.toggle()
	M.setup()
	local owner = session.get_current(vim.fn.getcwd())
	local terminal, owned = owned_terminal(owner)
	if not owned then
		return nil
	end
	if terminal ~= nil then
		record_source_context()
		terminal:toggle()
		return terminal
	end
	return M.start()
end

return M
