local cmd = vim.api.nvim_create_autocmd
local group = vim.api.nvim_create_augroup("autocommands", {})

cmd({ "BufRead", "BufNewFile" }, {
	pattern = { ".{eslint,babel,stylelint,prettier}rc" },
	command = "setlocal ft=json5",
	group = group,
})

cmd({ "FileType" }, {
	pattern = { "markdown", "gitcommit" },
	command = "setlocal spell spelllang=en_us",
	group = group,
})

cmd({ "TextYankPost" }, {
	command = "lua vim.highlight.on_yank({ higroup = 'IncSearch', timeout = 500 })",
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
