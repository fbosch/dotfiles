local repo_root = assert(vim.env.REPO_ROOT)
local registration

package.preload["config.pack.registry"] = function()
	return {
		register = function(value)
			registration = value
		end,
	}
end

local target = {
	cwd = repo_root,
	specifier = "herdr-w1-p1",
}
local metadata = {}
package.preload["utils.session"] = function()
	return {
		get_current = function()
			return target
		end,
		get_metadata = function()
			return metadata
		end,
		set_metadata = function(value)
			metadata = value
		end,
		set_opencode_session_id = function(session_id)
			metadata.opencode_session_id = session_id
		end,
	}
end

local captured_command
local terminal = {
	buf_valid = function()
		return true
	end,
	valid = function()
		return true
	end,
	on = function() end,
}
package.preload["snacks.terminal"] = function()
	return {
		open = function(command)
			captured_command = command
			return terminal
		end,
	}
end

dofile(repo_root .. "/.config/nvim/lua/plugins/ai/opencode.lua")
assert(type(registration) == "table" and type(registration[1]) == "table", "opencode plugin was not registered")
local corporate = vim.env.CORPORATE
vim.env.CORPORATE = "1"
assert(registration[1].enabled() == false, "opencode plugin was enabled in corporate context")
vim.env.CORPORATE = corporate
registration[1].init()

vim.g.opencode_opts.server.start()
assert(captured_command:find("opencode --port", 1, true), "fresh OpenCode command was not started")

metadata.opencode_session_id = "ses_exact"
local original_system = vim.system
vim.system = function()
	error("session fallback must not overwrite an exact OpenCode session ID")
end
local ok, err = pcall(vim.api.nvim_exec_autocmds, "User", { pattern = "SessionSavePre" })
vim.system = original_system
assert(ok, err)
assert(metadata.opencode_session_id == "ses_exact", "exact OpenCode session ID changed during save")
