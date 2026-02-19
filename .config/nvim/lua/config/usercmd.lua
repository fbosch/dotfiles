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
	local modules = { "anthropic", "codex", "copilot", "opencode" }
	for _, mod in ipairs(modules) do
		local ok, module = pcall(require, "utils.usage." .. mod)
		if ok and module.clear_cache then
			module.clear_cache()
		end
	end
	vim.notify("Refreshing usage stats...", vim.log.levels.INFO)
end, { desc = "Clear cache and refetch usage stats for all providers" })
