local utils = require("utils")
local pack_registry = require("config.pack.registry")
local usrcmd = utils.set_usrcmd
local keymap_modules = {
	"config.keymaps.core",
	"config.keymaps.navigation",
	"config.keymaps.yank",
	"config.keymaps.editing",
	"config.keymaps.plugins",
}

-- fix for the Z command
usrcmd("Z", "wa | qa")

usrcmd("DiffClip", function()
	local ftype = vim.api.nvim_eval("&filetype")
	vim.cmd(string.format(
		[[
    execute "normal! \"xy"
    vsplit
    enew
    normal! P
    setlocal buftype=nowrite
    set filetype=%s
    diffthis
    execute "normal! \<C-w>\<C-w>"
    enew
    set filetype=%s
    normal! "xP
    diffthis
  ]],
		ftype,
		ftype
	))
end, "Compare Active File with Clipboard")

usrcmd("WipeAllSessions", utils.wipe_all_sessions, { bang = true, desc = "Wipe all sessions" })

usrcmd("ReloadConfig", function()
	-- Only reload keymaps: other config modules register commands and autocmds that are not reload-safe.
	for _, module_name in ipairs(keymap_modules) do
		package.loaded[module_name] = nil
		require(module_name)
	end
	vim.notify("Reloaded Neovim keymaps", vim.log.levels.INFO)
end, "Reload Neovim keymaps")

local function enabled_plugin_names()
	local names = vim.tbl_keys(pack_registry.all())
	table.sort(names)
	return names
end

usrcmd("PackUpdate", function(args)
	for _, name in ipairs(args.fargs) do
		assert(pack_registry.get(name) ~= nil, "native plugin is disabled or unknown: " .. name)
	end
	vim.pack.update(#args.fargs > 0 and args.fargs or enabled_plugin_names())
end, {
	nargs = "*",
	desc = "Review native plugin updates",
	complete = function(arg_lead)
		return vim.iter(enabled_plugin_names())
			:filter(function(name)
				return vim.startswith(name, arg_lead)
			end)
			:totable()
	end,
})
