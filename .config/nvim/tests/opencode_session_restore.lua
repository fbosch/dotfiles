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
assert(
	vim.iter(registration[1].keys):any(function(key)
		return key[1] == "<C-\\>" and key.mode == "n"
	end),
	"Ctrl-Escape did not activate the OpenCode plugin"
)
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

local starts = 0
package.preload["opencode.config"] = function()
	return {
		opts = {
			server = {
				start = function()
					starts = starts + 1
				end,
			},
		},
	}
end

local source_buf = vim.api.nvim_create_buf(false, true)
vim.api.nvim_set_current_buf(source_buf)
local source_win = vim.api.nvim_get_current_win()
vim.cmd("vsplit")
local opencode_win = vim.api.nvim_get_current_win()
local opencode_buf = vim.api.nvim_create_buf(false, true)
vim.api.nvim_win_set_buf(opencode_win, opencode_buf)
vim.b[opencode_buf].is_opencode_terminal = true

registration[1].setup()
vim.api.nvim_set_current_win(source_win)

local focus_mapping = vim.fn.maparg("<C-\\>", "n", false, true)
assert(type(focus_mapping.callback) == "function", "Ctrl-Escape editor mapping was not configured")
focus_mapping.callback()
assert(
	vim.wait(100, function()
		return vim.api.nvim_get_current_win() == opencode_win
	end),
	"Ctrl-Escape did not focus the OpenCode window"
)

local terminal_mapping = vim.fn.maparg("<C-\\>", "n", false, true)
assert(terminal_mapping.buffer == 1, "Ctrl-Escape OpenCode mapping was not buffer-local")
terminal_mapping.callback()
assert(vim.api.nvim_get_current_win() == source_win, "Ctrl-Escape did not return to the editor")

vim.api.nvim_win_close(opencode_win, true)
focus_mapping.callback()
assert(
	vim.wait(100, function()
		return starts == 1
	end),
	"Ctrl-Escape did not reopen a hidden OpenCode window"
)
