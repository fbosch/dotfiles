local utils = require("utils")
local usrcmd = utils.set_usrcmd

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

usrcmd("RefreshUsage", function()
	local modules = { "codex", "copilot", "opencode" }
	for _, mod in ipairs(modules) do
		local ok, module = pcall(require, "utils.usage." .. mod)
		if ok and module.clear_cache then
			module.clear_cache()
		end
	end
	vim.notify("Refreshing usage stats...", vim.log.levels.INFO)
end, { desc = "Clear cache and refetch usage stats for all providers" })

usrcmd("PackUpdate", function(args)
	vim.pack.update(#args.fargs > 0 and args.fargs or nil)
end, {
	nargs = "*",
	desc = "Review native plugin updates",
	complete = function(arg_lead)
		local names = vim.iter(vim.pack.get())
			:map(function(plugin)
				return plugin.spec.name
			end)
			:filter(function(name)
				return vim.startswith(name, arg_lead)
			end)
			:totable()
		table.sort(names)
		return names
	end,
})
