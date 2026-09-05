local utils = require("utils")
local pack_inventory = require("config.pack.inventory")
local pack_loader = require("config.pack.loader")
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

usrcmd("PiStart", function()
	require("plugins.ai.pi").start()
end, "Start Pi bound to this Neovim instance")

usrcmd("PiToggle", function()
	require("plugins.ai.pi").toggle()
end, "Toggle Pi bound to this Neovim instance")

local function with_opencode(action)
	local activated, reason = pack_loader.activate("opencode.nvim", { source = "command" })
	if activated == false then
		vim.notify("OpenCode is unavailable: " .. reason, vim.log.levels.WARN)
		return
	end
	action(require("opencode.config").opts.server)
end

usrcmd("OpenCodeStart", function()
	with_opencode(function(server)
		server.start()
	end)
end, "Start the OpenCode rollback integration")

usrcmd("OpenCodeToggle", function()
	with_opencode(function(server)
		server.toggle()
	end)
end, "Toggle the OpenCode rollback integration")

usrcmd("OpenCodeAsk", function(args)
	with_opencode(function()
		local prefill = args.args ~= "" and args.args or "@this: "
		require("opencode").ask(prefill)
	end)
end, { nargs = "*", desc = "Open the retained OpenCode Ask input" })

usrcmd("ReloadConfig", function()
	-- Only reload keymaps: other config modules register commands and autocmds that are not reload-safe.
	for _, module_name in ipairs(keymap_modules) do
		package.loaded[module_name] = nil
		require(module_name)
	end
	vim.notify("Reloaded Neovim keymaps", vim.log.levels.INFO)
end, "Reload Neovim keymaps")

local function enabled_plugin_names()
	return pack_inventory.current().enabled_names
end

usrcmd("PackUpdate", function(args)
	local inventory = pack_inventory.current()
	for _, name in ipairs(args.fargs) do
		assert(inventory.enabled_by_name[name] ~= nil, "native plugin is disabled or unknown: " .. name)
	end
	vim.pack.update(#args.fargs > 0 and args.fargs or inventory.enabled_names)
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
