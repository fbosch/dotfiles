local repo_root = assert(vim.env.REPO_ROOT)
local metadata_root = vim.fn.tempname()
local nvim_session = {
	cwd = repo_root,
	metadata_path = metadata_root .. "/session.json",
}
local session = dofile(repo_root .. "/.config/nvim/lua/utils/session.lua")
session.set_current(nvim_session)
session.set_metadata({
	opencode_session_id = "ses_exact",
	opencode_terminal_open = true,
}, nvim_session)
package.loaded["utils.session"] = session
package.loaded["utils.pi_session"] = dofile(repo_root .. "/.config/nvim/lua/utils/pi_session.lua")

local captured_command
local captured_options
local callbacks = {}
local terminal = {
	buf = vim.api.nvim_create_buf(false, true),
	buf_valid = function()
		return true
	end,
	focus = function(self)
		return self
	end,
	on = function(_, event, callback)
		callbacks[event] = callback
	end,
	show = function(self)
		return self
	end,
	valid = function()
		return true
	end,
}
package.loaded["snacks.terminal"] = {
	open = function(command, options)
		captured_command = command
		captured_options = options
		options.win.on_buf(terminal)
		return terminal
	end,
}

vim.cmd("edit " .. vim.fn.fnameescape(repo_root .. "/.config/nvim/lua/config/usercmd.lua"))
vim.api.nvim_win_set_cursor(0, { 1, 0 })
vim.cmd("normal! v2l")
local pi = dofile(repo_root .. "/.config/nvim/lua/utils/pi.lua")
local first = pi.start()
assert(first == terminal, "Pi launcher did not return its terminal")
assert(captured_command ~= nil, "Pi launcher did not open a terminal")
assert(
	captured_command == "PI_NVIM_SOCKET=" .. vim.fn.shellescape(vim.v.servername) .. " pi",
	"fresh Pi launcher did not let Pi assign its session ID"
)
assert(
	vim.g.pi_launch_source_context.buffer.name == repo_root .. "/.config/nvim/lua/config/usercmd.lua",
	"Pi launcher did not capture the source context before opening its terminal"
)
assert(vim.g.pi_launch_source_context.mode == "v", "Pi launcher did not capture source mode")
assert(vim.g.pi_launch_source_context.selection.mode == "v", "Pi launcher did not capture visual mode")
assert(
	vim.g.pi_launch_source_context.selection.lines[1] == "loc",
	"Pi launcher did not capture the bounded pre-Pi selection"
)
assert(captured_options.win.position == "left", "Pi terminal was not opened on the left")
assert(captured_options.win.width == 100, "Pi terminal width changed")
assert(vim.b[terminal.buf].is_pi_terminal == true, "Pi terminal buffer was not marked")
assert(type(callbacks.TermClose) == "function", "Pi terminal close was not tracked")

vim.api.nvim_exec_autocmds("User", { pattern = "SessionSavePre" })
local saved_metadata = session.get_metadata(nvim_session)
assert(saved_metadata.pi_session_id == nil, "unbound Pi terminal invented a session ID")
assert(saved_metadata.pi_terminal_open == false, "unbound Pi terminal was marked restorable")
assert(saved_metadata.opencode_session_id == "ses_exact", "OpenCode session ID changed during Pi save")
assert(saved_metadata.opencode_terminal_open == true, "OpenCode terminal state changed during Pi save")

local first_session_id = "pi-session-one"
assert(pi.bind_session("invalid/session") == false, "invalid Pi session ID was bound")
assert(pi.bind_session(first_session_id) == true, "Pi-assigned session ID was not bound")
vim.api.nvim_exec_autocmds("User", { pattern = "SessionSavePre" })
saved_metadata = session.get_metadata(nvim_session)
assert(saved_metadata.pi_session_id == first_session_id, "bound Pi session ID was not saved")
assert(saved_metadata.pi_terminal_open == true, "bound Pi terminal state was not saved")
assert(saved_metadata.opencode_session_id == "ses_exact", "OpenCode session ID changed after Pi binding")
assert(saved_metadata.opencode_terminal_open == true, "OpenCode terminal state changed after Pi binding")

local restored_session = dofile(repo_root .. "/.config/nvim/lua/utils/session.lua")
local restored_metadata = restored_session.get_metadata(nvim_session)
assert(restored_metadata.pi_session_id == first_session_id, "Pi session ID did not survive metadata load")
assert(restored_metadata.pi_terminal_open == true, "Pi terminal state did not survive metadata load")
assert(restored_metadata.opencode_session_id == "ses_exact", "OpenCode session ID did not survive metadata load")
assert(restored_metadata.opencode_terminal_open == true, "OpenCode terminal state did not survive metadata load")

local second_source = repo_root .. "/.config/nvim/lua/utils/pi.lua"
vim.cmd("edit " .. vim.fn.fnameescape(second_source))
captured_command = nil
assert(pi.start() == terminal, "Pi launcher did not reuse its live terminal")
assert(captured_command == nil, "Pi launcher opened a duplicate terminal")
assert(
	vim.g.pi_launch_source_context.buffer.name == second_source,
	"Pi launcher did not refresh source context before reusing its terminal"
)

callbacks.TermClose()
vim.api.nvim_exec_autocmds("User", { pattern = "SessionSavePre" })
saved_metadata = session.get_metadata(nvim_session)
assert(saved_metadata.pi_session_id == first_session_id, "closed Pi terminal discarded its session ID")
assert(saved_metadata.pi_terminal_open == false, "closed Pi terminal state was not saved")
assert(saved_metadata.opencode_session_id == "ses_exact", "OpenCode session ID changed after Pi close")

captured_command = nil
pi.start()
assert(captured_command ~= nil, "Pi launcher did not reopen after terminal close")
assert(
	captured_command == "PI_NVIM_SOCKET=" .. vim.fn.shellescape(vim.v.servername) .. " pi",
	"reopened Pi launcher supplied a synthetic session ID"
)
local second_session_id = "pi-session-two"
assert(pi.bind_session(second_session_id) == true, "replacement Pi session ID was not bound")
vim.api.nvim_exec_autocmds("User", { pattern = "SessionSavePre" })
saved_metadata = session.get_metadata(nvim_session)
assert(saved_metadata.pi_session_id == second_session_id, "replacement Pi session ID was not saved")
assert(saved_metadata.pi_terminal_open == true, "replacement Pi terminal state was not saved")

vim.fn.delete(metadata_root, "rf")
