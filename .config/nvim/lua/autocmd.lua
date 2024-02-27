local cmd = vim.api.nvim_create_autocmd
local group = vim.api.nvim_create_augroup("autocommands", {})

cmd({ "BufRead", "BufNewFile" }, {
	pattern = { ".{eslint,babel,stylelint,prettier}rc" },
	command = "setlocal ft=json5",
	group = group,
})

cmd({ "FileType" }, {
	pattern = { "markdown", "gitcommit" },
	command = "setlocal spell spelllang=en_us colorcolumn=80",
	group = group,
})

cmd({ "TextYankPost" }, {
	command = "lua vim.highlight.on_yank({ higroup = 'IncSearch', timeout = 300 })",
	group = group,
})

cmd({ "FileType" }, {
	command = "cabbrev wqa Z",
	group = group,
})

cmd({ "InsertLeave" }, {
	command = "set nopaste",
	group = group,
})

-- enable relative line numbers in insert mode
cmd({ "BufEnter", "FocusGained", "InsertLeave", "CmdlineLeave", "WinEnter" }, {
	pattern = "*",
	group = group,
	callback = function()
		if vim.o.nu and vim.api.nvim_get_mode().mode ~= "i" then
			vim.opt.relativenumber = true
		end
	end,
})

-- disable relative line numbers in normal mode
cmd({ "BufLeave", "FocusLost", "InsertEnter", "CmdlineEnter", "WinLeave" }, {
	pattern = "*",
	group = group,
	callback = function()
		if vim.o.nu then
			vim.opt.relativenumber = false
			vim.cmd("redraw")
		end
	end,
})
