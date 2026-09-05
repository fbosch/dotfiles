local repo_root = assert(vim.env.REPO_ROOT)
package.path = table.concat({
	repo_root .. "/.config/nvim/lua/?.lua",
	repo_root .. "/.config/nvim/lua/?/init.lua",
	package.path,
}, ";")

local starts = 0
local toggles = 0
package.loaded["plugins.ai.pi"] = {
	start = function()
		starts = starts + 1
	end,
	toggle = function()
		toggles = toggles + 1
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

for _, case in ipairs({
	{ "n", "Focus Pi with source context" },
	{ "x", "Focus Pi with source context" },
	{ "n", "Add source context to Pi" },
	{ "x", "Add source context to Pi" },
	{ "n", "Focus Pi" },
	{ "n", "Focus Pi with visible buffers" },
	{ "x", "Focus Pi with selection" },
}) do
	mapping(case[1], case[2]).callback()
end
assert(starts == 7, "Pi context and focus mappings did not start Pi")
mapping("n", "Toggle Pi").callback()
mapping("t", "Toggle Pi").callback()
assert(toggles == 2, "Pi toggle mappings did not toggle Pi")
local rollback = mapping("n", "Toggle OpenCode rollback")
assert(rollback.rhs:find("OpenCodeToggle", 1, true) ~= nil, "OpenCode rollback key changed")

for _, command in ipairs({
	"PiStart",
	"PiToggle",
	"OpenCodeStart",
	"OpenCodeToggle",
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

dofile(repo_root .. "/.config/nvim/lua/config/usercmd.lua")
vim.cmd("PiStart")
vim.cmd("PiToggle")
vim.cmd("OpenCodeStart")
vim.cmd("OpenCodeToggle")
assert(starts == 8 and toggles == 3, "Pi commands did not use the cutover integration")
assert(activations == 2, "OpenCode rollback commands did not activate the plugin")
assert(opencode_starts == 1, "OpenCode rollback start command did not start OpenCode")
assert(opencode_toggles == 1, "OpenCode rollback toggle command did not toggle OpenCode")
