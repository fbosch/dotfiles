local pi_session = require("utils.pi_session")
local session = require("utils.session")

local M = {}

local terminal_instance
local terminal_session_id
local terminal_owner
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

local function current_terminal()
	if terminal_instance ~= nil and terminal_instance:buf_valid() then
		return terminal_instance
	end

	terminal_instance = nil
	terminal_session_id = nil
	terminal_owner = nil
	return nil
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
		vim.g.pi_launch_source_context = context
	end
end

local function launch_command(session_flag, session_id, session_dir, socket)
	if type(socket) ~= "string" or socket == "" then
		error("pi requires a Neovim RPC socket")
	end

	local command = "PI_NVIM_SOCKET=" .. vim.fn.shellescape(socket) .. " pi"
	if session_dir ~= nil then
		command = command .. " --session-dir " .. vim.fn.shellescape(session_dir)
	end
	if session_flag == nil or session_id == nil then
		return command
	end
	return command .. " " .. session_flag .. " " .. vim.fn.shellescape(session_id)
end

local function open_terminal(session_flag, session_id, session_dir, cwd, socket, owner)
	local options = {
		cwd = cwd,
		win = terminal_options.win,
	}
	local terminal =
		require("snacks.terminal").open(launch_command(session_flag, session_id, session_dir, socket), options)
	terminal_instance = terminal
	terminal_session_id = session_id
	terminal_owner = owner
	local function clear_terminal()
		if terminal_instance == terminal then
			terminal_instance = nil
			terminal_session_id = nil
			terminal_owner = nil
		end
	end
	terminal:on("TermClose", clear_terminal, { buf = true })
	terminal:on("BufWipeout", clear_terminal, { buf = true })
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

function M.restore()
	local nvim_session = session.get_current()
	if nvim_session == nil then
		return false
	end

	local metadata = session.get_metadata(nvim_session)
	if metadata.pi_terminal_open ~= true then
		return false
	end
	local session_id = metadata.pi_session_id
	if not session.is_valid_pi_session_id(session_id) then
		notify_restore_failure("invalid_id")
		return false
	end
	if vim.fn.executable("pi") ~= 1 then
		vim.notify("Pi session was not restored: pi executable not found.", vim.log.levels.WARN)
		return false
	end

	if session.get_current(vim.fn.getcwd()) ~= nvim_session then
		notify_restore_failure("wrong_worktree")
		return false
	end
	local existing = current_terminal()
	if existing ~= nil then
		if terminal_owner ~= nvim_session then
			vim.notify("Pi session was not restored: another Pi terminal is already open.", vim.log.levels.WARN)
		end
		return false
	end

	local socket = vim.v.servername
	local found, reason = pi_session.find_exact(session_id, nvim_session.cwd)
	if found == nil then
		notify_restore_failure(reason)
		return false
	end
	if session.get_current(vim.fn.getcwd()) ~= nvim_session or vim.v.servername ~= socket then
		notify_restore_failure("wrong_worktree")
		return false
	end

	local ok = pcall(open_terminal, "--session", session_id, found.directory, found.cwd, socket, nvim_session)
	if not ok then
		notify_restore_failure("open_failed")
		return false
	end
	return true
end

function M.bind_session(session_id)
	if not session.is_valid_pi_session_id(session_id) then
		return false
	end
	local terminal = current_terminal()
	local owner = session.get_current(vim.fn.getcwd())
	if terminal == nil or owner == nil or terminal_owner ~= owner then
		return false
	end
	terminal_session_id = session_id
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

function M.start()
	M.setup()
	if vim.fn.executable("pi") ~= 1 then
		vim.notify("pi executable not found", vim.log.levels.ERROR)
		return nil
	end

	record_source_context()
	local terminal = current_terminal()
	if terminal ~= nil then
		terminal:show():focus()
		return terminal
	end

	local owner = session.get_current(vim.fn.getcwd())
	local cwd = owner ~= nil and owner.cwd or vim.fn.getcwd()
	return open_terminal(nil, nil, nil, cwd, vim.v.servername, owner)
end

return M
