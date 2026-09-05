local pi_bridge = require("plugins.ai.pi.bridge")
local pi_session = require("plugins.ai.pi.session")
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
	local prompt = package.loaded["plugins.ai.pi.prompt"]
	if type(prompt) == "table" and type(prompt.terminal_closed) == "function" then
		prompt.terminal_closed(closed_launch_id)
	end
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
	terminal:on("TermClose", clear_terminal, { buf = true })
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

local function resume_saved_session(nvim_session, launch_options)
	local session_id = session.get_metadata(nvim_session).pi_session_id
	if not session.is_valid_pi_session_id(session_id) then
		notify_restore_failure("invalid_id")
		return nil
	end
	if vim.fn.executable("pi") ~= 1 then
		vim.notify("Pi session was not restored: pi executable not found.", vim.log.levels.WARN)
		return nil
	end

	if session.get_current(vim.fn.getcwd()) ~= nvim_session then
		notify_restore_failure("wrong_worktree")
		return nil
	end
	local existing = current_terminal()
	if existing ~= nil then
		if terminal_owner ~= nvim_session then
			vim.notify("Pi session was not restored: another Pi terminal is already open.", vim.log.levels.WARN)
		end
		return nil
	end

	local socket = vim.v.servername
	local found, reason = pi_session.find_exact(session_id, nvim_session.cwd)
	if found == nil then
		notify_restore_failure(reason)
		return nil
	end
	if session.get_current(vim.fn.getcwd()) ~= nvim_session or vim.v.servername ~= socket then
		notify_restore_failure("wrong_worktree")
		return nil
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
			local prompt = package.loaded["plugins.ai.pi.prompt"]
			if type(prompt) == "table" and type(prompt.session_replaced) == "function" then
				prompt.session_replaced(binding.launchId)
			end
		end
	end

	terminal_session_id = session_id
	if not session.set_pi_terminal_state(session_id, true, owner) then
		return false
	end
	if type(binding) ~= "table" or binding.launchId == nil then
		terminal_bound = false
		terminal_channel_id = nil
		local prompt = package.loaded["plugins.ai.pi.prompt"]
		if type(prompt) == "table" and type(prompt.binding_unavailable) == "function" then
			prompt.binding_unavailable(terminal_launch_id)
		end
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
		local prompt = package.loaded["plugins.ai.pi.prompt"]
		if type(prompt) == "table" and type(prompt.on_bound) == "function" then
			prompt.on_bound(identity)
		end
	end)
	return identity
end

function M.prompt_launch()
	if current_terminal() == nil then
		return nil
	end
	local owner = session.get_current(vim.fn.getcwd())
	if owner == nil or terminal_owner ~= owner then
		return nil
	end
	return {
		cwd = canonical_path(owner.cwd),
		editorPid = vim.fn.getpid(),
		launchId = terminal_launch_id,
		ownerId = terminal_owner_id,
		sessionId = terminal_session_id,
	}
end

function M.prompt_identity()
	if not terminal_bound then
		return nil
	end
	local launch = M.prompt_launch()
	if launch == nil then
		return nil
	end
	return vim.tbl_extend("force", launch, {
		version = 1,
		channelId = terminal_channel_id,
		sessionId = terminal_session_id,
	})
end

function M.focus_bound(expected)
	local identity = M.prompt_identity()
	if
		identity == nil
		or type(expected) ~= "table"
		or identity.channelId ~= expected.channelId
		or identity.launchId ~= expected.launchId
		or identity.sessionId ~= expected.sessionId
	then
		return false
	end
	local terminal = current_terminal()
	if terminal == nil then
		return false
	end
	terminal:show():focus()
	return true
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

function M.ensure_started(options)
	options = options or {}
	M.setup()
	if vim.fn.executable("pi") ~= 1 then
		vim.notify("pi executable not found", vim.log.levels.ERROR)
		return nil
	end

	local owner = session.get_current(vim.fn.getcwd())
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

	if owner ~= nil and session.get_metadata(owner).pi_session_id ~= nil then
		return resume_saved_session(owner, options)
	end
	local cwd = owner ~= nil and owner.cwd or vim.fn.getcwd()
	return open_terminal(nil, nil, nil, cwd, vim.v.servername, owner, options)
end

function M.start()
	return M.ensure_started({ focus = true })
end

function M.toggle()
	M.setup()
	if vim.fn.executable("pi") ~= 1 then
		vim.notify("pi executable not found", vim.log.levels.ERROR)
		return nil
	end

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
