local repo_root = assert(vim.env.REPO_ROOT)
local original_cwd = vim.fn.getcwd()
local test_root = vim.fn.tempname()
vim.fn.mkdir(test_root, "p")
test_root = vim.uv.fs_realpath(test_root) or test_root
local project = test_root .. "/project"
vim.fn.mkdir(project .. "/.git", "p")
vim.cmd("cd " .. vim.fn.fnameescape(project))

local nvim_session = {
	cwd = project,
	metadata_path = test_root .. "/session.json",
	specifier = "direnv-launch-fixture",
}
local session = dofile(repo_root .. "/.config/nvim/lua/utils/session.lua")
session.set_current(nvim_session)
session.set_metadata({}, nvim_session)
package.loaded["utils.session"] = session

local direnv_calls = 0
package.loaded["config.direnv"] = {
	synchronize = function()
		direnv_calls = direnv_calls + 1
		error("direnv is unavailable")
	end,
}
package.loaded["plugins.ai.pi.bridge"] = {
	record_source_context = function()
		return true
	end,
}
package.loaded["plugins.ai.pi.session"] = {
	find_exact = function(_, cwd)
		return { directory = test_root .. "/pi-sessions", cwd = cwd }, nil
	end,
}

local opened = {}
local terminal_callbacks = {}
local terminal = {
	buf = vim.api.nvim_create_buf(false, true),
	buf_valid = function()
		return true
	end,
	valid = function()
		return true
	end,
	show = function(self)
		return self
	end,
	focus = function(self)
		return self
	end,
	close = function(self)
		return self
	end,
	on = function(_, event, callback)
		terminal_callbacks[event] = callback
	end,
}
package.loaded["snacks.terminal"] = {
	open = function(command, options)
		table.insert(opened, { command = command, options = options })
		options.win.on_buf(terminal)
		return terminal
	end,
}

local pi = dofile(repo_root .. "/.config/nvim/lua/plugins/ai/pi/init.lua")
assert(pi.start() == terminal, "Pi launch was blocked by unavailable direnv")
assert(direnv_calls == 0, "Pi launch consulted direnv")
assert(#opened == 1, "fresh Pi launch opened the wrong number of terminals")

assert(pi.start() == terminal, "existing Pi terminal was not reused")
assert(direnv_calls == 0, "reusing Pi consulted direnv")
assert(#opened == 1, "existing Pi terminal was opened again")
terminal_callbacks.TermClose()

session.set_metadata({ pi_terminal_open = false }, nvim_session)
local opened_before_restore = #opened
session.set_metadata({ pi_session_id = "restore-session", pi_terminal_open = true }, nvim_session)
assert(pi.restore() == true, "saved Pi restore was blocked by unavailable direnv")
assert(direnv_calls == 0, "restoring Pi consulted direnv")
assert(#opened == opened_before_restore + 1, "saved restore did not open Pi")
terminal_callbacks.TermClose()

vim.cmd("cd " .. vim.fn.fnameescape(original_cwd))
vim.fn.delete(test_root, "rf")
