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

usrcmd("ProjectFindAndReplaceWord", function()
	local word = vim.fn.expand("<cword>")
	vim.fn.setreg("v", word) -- yank word under cursor
	utils.project_find_and_replace(word, { word = true })
end, "Project-wide find and replace current word")

usrcmd("ProjectFindAndReplaceSelection", function()
	local selection = vim.fn.getreg("v")
	if not selection or selection == "" then
		vim.notify("No text selected.", vim.log.levels.WARN)
		return
	end
	utils.project_find_and_replace(selection)
end, "Project-wide find and replace selection")
