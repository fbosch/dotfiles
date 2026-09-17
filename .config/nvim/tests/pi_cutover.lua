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
	ask = function(prefill)
		table.insert(pi_asks, prefill)
	end,
	start = function()
		starts = starts + 1
	end,
	toggle = function()
		toggles = toggles + 1
	end,
}
package.loaded["plugins.ai.pi.prompt"] = nil
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
mapping("n", "Toggle Pi").callback()
mapping("t", "Toggle Pi").callback()
assert(toggles == 2, "Pi toggle mappings did not toggle Pi")
for _, mode in ipairs({ "n", "x" }) do
	local ask = mapping(mode, "Ask Pi")
	ask.callback()
end
assert(vim.deep_equal(pi_asks, { "", "" }), "Pi Ask mapping callbacks did not call pi.ask with literal input")
for _, mode in ipairs({ "n", "x", "t" }) do
	assert(
		vim.iter(vim.api.nvim_get_keymap(mode)):all(function(candidate)
			return candidate.desc == nil or candidate.desc:find("OpenCode", 1, true) == nil
		end),
		"OpenCode mapping survived the Pi-only cutover"
	)
end

for _, command in ipairs({
	"PiStart",
	"PiToggle",
	"PiAsk",
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
		return { by_name = {}, names = {} }
	end,
}

dofile(repo_root .. "/.config/nvim/lua/config/usercmd.lua")
vim.cmd("PiStart")
vim.cmd("PiToggle")
vim.cmd("PiAsk")
vim.cmd("PiAsk literal prompt")
assert(starts == 2 and toggles == 3, "Pi commands did not use the cutover integration")
assert(vim.deep_equal(pi_asks, { "", "", "", "literal prompt" }), "Pi Ask did not preserve literal prefill")
for _, command in ipairs({ "OpenCodeStart", "OpenCodeToggle", "OpenCodeAsk" }) do
	assert(vim.fn.exists(":" .. command) == 0, command .. " survived the Pi-only cutover")
end
