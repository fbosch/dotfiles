local repo_root = assert(vim.env.REPO_ROOT)

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
	"Pi launcher did not bind the launching Neovim socket"
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
pi.start()
assert(captured_command ~= nil, "Pi launcher did not reopen after terminal close")
