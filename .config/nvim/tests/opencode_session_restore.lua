local repo_root = assert(vim.env.REPO_ROOT)

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

local registration = dofile(repo_root .. "/.config/nvim/lua/plugins/ai/opencode.lua")
assert(type(registration) == "table" and type(registration[1]) == "table", "opencode plugin was not registered")
local function registers_key(lhs)
	return vim.iter(registration[1].keys):any(function(key)
		return key[1] == lhs
	end)
end
for _, lhs in ipairs({ "<leader>ac", "ga", "<A-x>", "<leader>as" }) do
	assert(registers_key(lhs), "OpenCode prompt workflow no longer activates the plugin: " .. lhs)
end
for _, lhs in ipairs({ "<C-\\>", "<A-a>" }) do
	assert(registers_key(lhs) == false, "OpenCode still claims Pi's default key: " .. lhs)
end
local corporate = vim.env.CORPORATE
vim.env.CORPORATE = "1"
assert(registration[1].enabled() == false, "opencode plugin was enabled in corporate context")
vim.env.CORPORATE = corporate
registration[1].init()

vim.g.opencode_opts.server.start()
assert(captured_command:find("opencode --port", 1, true), "fresh OpenCode command was not started")

metadata.opencode_session_id = "ses_exact"
local original_system = vim.system
rawset(vim, "system", function()
	error("session fallback must not overwrite an exact OpenCode session ID")
end)
local ok, err = pcall(vim.api.nvim_exec_autocmds, "User", { pattern = "SessionSavePre" })
rawset(vim, "system", original_system)
assert(ok, err)
assert(metadata.opencode_session_id == "ses_exact", "exact OpenCode session ID changed during save")

metadata.opencode_session_id = nil
local fallback_query
rawset(vim, "system", function(command)
	fallback_query = command[#command]
	return {
		wait = function()
			return { code = 0, stdout = '[{"id":"ses_inferred"}]' }
		end,
	}
end)
vim.api.nvim_exec_autocmds("User", { pattern = "SessionSavePre" })
rawset(vim, "system", original_system)
assert(type(fallback_query) == "string", "fresh OpenCode session lookup did not run")
assert(fallback_query:lower():find(" like ", 1, true) == nil, "OpenCode session lookup retained SQL wildcards")
assert(fallback_query:find("substr(directory", 1, true) ~= nil, "OpenCode session lookup lost descendant matching")
assert(metadata.opencode_session_id == "ses_inferred", "fresh OpenCode session ID was not persisted")

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
for _, expected in ipairs({
	{ mode = "n", description = "Ask opencode" },
	{ mode = "x", description = "Ask opencode" },
	{ mode = "n", description = "Add to opencode" },
	{ mode = "x", description = "Add to opencode" },
	{ mode = "n", description = "Send to opencode" },
	{ mode = "x", description = "Send to opencode" },
}) do
	assert(
		vim.iter(vim.api.nvim_get_keymap(expected.mode)):any(function(mapping)
			return mapping.desc == expected.description
		end),
		("OpenCode did not restore %s in %s mode"):format(expected.description, expected.mode)
	)
end
assert(
	vim.iter(vim.api.nvim_get_keymap("n")):all(function(mapping)
		return mapping.desc ~= "Toggle opencode focus"
	end),
	"OpenCode replaced Pi's global focus key"
)

vim.api.nvim_set_current_win(opencode_win)
local terminal_mapping = vim.iter(vim.api.nvim_buf_get_keymap(opencode_buf, "n")):find(function(mapping)
	return mapping.desc == "Toggle opencode focus"
end)
assert(terminal_mapping ~= nil, "Ctrl-Escape OpenCode mapping was not buffer-local")
terminal_mapping.callback()
assert(vim.api.nvim_get_current_win() == source_win, "Ctrl-Escape did not return to the editor")
assert(starts == 0, "OpenCode started unexpectedly during terminal navigation")
