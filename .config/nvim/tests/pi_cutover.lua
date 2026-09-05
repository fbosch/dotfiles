local repo_root = assert(vim.env.REPO_ROOT)
package.path = table.concat({
	repo_root .. "/.config/nvim/lua/?.lua",
	repo_root .. "/.config/nvim/lua/?/init.lua",
	package.path,
}, ";")

local starts = 0
local toggles = 0
local pi_asks = {}
package.loaded["plugins.ai.pi"] = {
	start = function()
		starts = starts + 1
	end,
	toggle = function()
		toggles = toggles + 1
	end,
}
package.loaded["plugins.ai.pi.prompt"] = {
	ask = function(prefill)
		table.insert(pi_asks, prefill)
	end,
}
package.loaded["utils"] = {
	set_keymap = function(mode, lhs, rhs, desc)
		vim.keymap.set(mode, lhs, rhs, { desc = desc, silent = true })
	end,
}
package.loaded["utils.web"] = {
	open_branch_workitem = function() end,
	open_git_remote_url = function() end,
	open_uris_in_buffer = function() end,
	open_uris_in_selection = function() end,
}

dofile(repo_root .. "/.config/nvim/lua/config/keymaps/plugins.lua")

local function mapping(mode, description)
	return assert(
		vim.iter(vim.api.nvim_get_keymap(mode)):find(function(candidate)
			return candidate.desc == description
		end),
		("missing %s mapping: %s"):format(mode, description)
	)
end

mapping("n", "Focus Pi").callback()
assert(starts == 1, "Pi focus mapping did not start Pi")
for _, description in ipairs({
	"Focus Pi with source context",
	"Add source context to Pi",
	"Focus Pi with visible buffers",
}) do
	assert(
		vim.iter(vim.api.nvim_get_keymap("n")):all(function(candidate)
			return candidate.desc ~= description
		end),
		"Pi still claims an OpenCode prompt mapping: " .. description
	)
end
mapping("n", "Toggle Pi").callback()
mapping("t", "Toggle Pi").callback()
assert(toggles == 2, "Pi toggle mappings did not toggle Pi")
local rollback = mapping("n", "Toggle OpenCode rollback")
assert(rollback.rhs:find("OpenCodeToggle", 1, true) ~= nil, "OpenCode rollback key changed")

for _, command in ipairs({
	"PiStart",
	"PiToggle",
	"PiAsk",
	"OpenCodeStart",
	"OpenCodeToggle",
	"OpenCodeAsk",
	"ReloadConfig",
	"Z",
	"DiffClip",
	"WipeAllSessions",
	"PackUpdate",
}) do
	pcall(vim.api.nvim_del_user_command, command)
end

local function set_usrcmd(name, command, options)
	if type(options) == "string" then
		options = { desc = options }
	end
	vim.api.nvim_create_user_command(name, command, options or {})
end
package.loaded["utils"] = {
	set_usrcmd = set_usrcmd,
	wipe_all_sessions = function() end,
}
package.loaded["config.pack.inventory"] = {
	current = function()
		return { enabled_by_name = { ["opencode.nvim"] = {} }, enabled_names = { "opencode.nvim" } }
	end,
}
local activations = 0
package.loaded["config.pack.loader"] = {
	activate = function(name)
		assert(name == "opencode.nvim", "rollback command activated the wrong plugin")
		activations = activations + 1
		return true
	end,
}
local opencode_starts = 0
local opencode_toggles = 0
local opencode_asks = {}
package.loaded["opencode.config"] = {
	opts = {
		server = {
			start = function()
				opencode_starts = opencode_starts + 1
			end,
			toggle = function()
				opencode_toggles = opencode_toggles + 1
			end,
		},
	},
}
package.loaded["opencode"] = {
	ask = function(prefill)
		table.insert(opencode_asks, prefill)
	end,
}

dofile(repo_root .. "/.config/nvim/lua/config/usercmd.lua")
vim.cmd("PiStart")
vim.cmd("PiToggle")
vim.cmd("PiAsk")
vim.cmd("PiAsk literal prompt")
vim.cmd("OpenCodeStart")
vim.cmd("OpenCodeToggle")
vim.cmd("OpenCodeAsk")
vim.cmd("OpenCodeAsk explain this")
assert(starts == 2 and toggles == 3, "Pi commands did not use the cutover integration")
assert(vim.deep_equal(pi_asks, { "", "literal prompt" }), "Pi Ask did not preserve literal prefill")
assert(activations == 4, "OpenCode rollback commands did not activate the plugin")
assert(opencode_starts == 1, "OpenCode rollback start command did not start OpenCode")
assert(opencode_toggles == 1, "OpenCode rollback toggle command did not toggle OpenCode")
assert(vim.deep_equal(opencode_asks, { "@this: ", "explain this" }), "OpenCode Ask did not preserve prefill")
