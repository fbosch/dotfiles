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
