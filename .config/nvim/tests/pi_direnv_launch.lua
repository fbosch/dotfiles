local repo_root = assert(vim.env.REPO_ROOT)
local original_cwd = vim.fn.getcwd()
local test_root = vim.fn.tempname()
local project = test_root .. "/project"
local sibling = test_root .. "/sibling"
vim.fn.mkdir(project .. "/.git", "p")
vim.fn.mkdir(sibling, "p")
vim.fn.writefile({ "# fixture; never executed" }, project .. "/.envrc")
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

local synchronization_result = { ok = true, status = "loaded", cwd = project }
local synchronize_calls = {}
package.loaded["config.direnv"] = {
	synchronize = function(cwd)
		table.insert(synchronize_calls, cwd)
		return synchronization_result
	end,
	failure_message = function(status)
		return "environment fixture: " .. status
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
		assert(#synchronize_calls > 0, "Pi spawned before synchronizing the project environment")
		table.insert(opened, { command = command, options = options })
		options.win.on_buf(terminal)
		return terminal
	end,
}

local pi = dofile(repo_root .. "/.config/nvim/lua/plugins/ai/pi/init.lua")
assert(pi.start() == terminal, "fresh Pi launch failed after environment synchronization")
assert(synchronize_calls[1] == project, "fresh Pi synchronized the wrong cwd")
assert(#opened == 1, "fresh Pi launch opened the wrong number of terminals")

synchronization_result = { ok = false, status = "blocked", cwd = project }
assert(pi.start() == terminal, "existing Pi terminal was not reused")
assert(#synchronize_calls == 1, "existing Pi terminal triggered a new environment load")
assert(#opened == 1, "existing Pi terminal was opened again")
terminal_callbacks.TermClose()

session.set_metadata({ pi_terminal_open = false }, nvim_session)
local opened_before_failure = #opened
assert(pi.start() == nil, "blocked project environment still launched Pi")
assert(#opened == opened_before_failure, "blocked project environment spawned Pi")
assert(synchronize_calls[#synchronize_calls] == project, "blocked launch checked the wrong cwd")

session.set_metadata({ pi_session_id = "restore-session", pi_terminal_open = true }, nvim_session)
synchronization_result = { ok = true, status = "loaded", cwd = project }
assert(pi.restore() == true, "saved Pi restore failed after environment synchronization")
assert(synchronize_calls[#synchronize_calls] == project, "saved restore synchronized the wrong cwd")
assert(#opened == opened_before_failure + 1, "saved restore did not open Pi")
terminal_callbacks.TermClose()

session.set_metadata({ pi_terminal_open = false }, nvim_session)
synchronization_result = { ok = true, status = "loaded", cwd = project }
local original_synchronize = package.loaded["config.direnv"].synchronize
package.loaded["config.direnv"].synchronize = function(cwd)
	table.insert(synchronize_calls, cwd)
	vim.cmd("cd " .. vim.fn.fnameescape(sibling))
	return original_synchronize(cwd)
end
assert(pi.start() == nil, "Pi launched after the worktree changed during synchronization")
assert(#opened == opened_before_failure + 1, "worktree race spawned Pi")
vim.cmd("cd " .. vim.fn.fnameescape(original_cwd))
vim.fn.delete(test_root, "rf")
