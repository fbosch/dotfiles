local repo_root = assert(vim.env.REPO_ROOT)

local captured_command
local captured_options
local callbacks = {}
local terminal = {
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
		return terminal
	end,
}

vim.cmd("edit " .. vim.fn.fnameescape(repo_root .. "/.config/nvim/lua/config/usercmd.lua"))
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
assert(captured_options.win.position == "left", "Pi terminal was not opened on the left")
assert(captured_options.win.width == 100, "Pi terminal width changed")
assert(type(callbacks.TermClose) == "function", "Pi terminal close was not tracked")

captured_command = nil
assert(pi.start() == terminal, "Pi launcher did not reuse its live terminal")
assert(captured_command == nil, "Pi launcher opened a duplicate terminal")

callbacks.TermClose()
pi.start()
assert(captured_command ~= nil, "Pi launcher did not reopen after terminal close")
