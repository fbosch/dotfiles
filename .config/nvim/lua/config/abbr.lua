local utils = require("utils")
local ft_abbr = require("config.autocmd").setup_filetype_abbreviations

local typos = {
	teh = "the",
	seperate = "separate",
	definately = "definitely",
	cahnge = "change",
	futher = "further",
}

ft_abbr({ "javascript", "javascriptreact", "typescript", "typescriptreact" }, {
	cl = "console.log()<esc>h",
	cdir = "console.dir()<esc>h",
	cer = "console.error()<esc>h",
	cwar = "console.warn()<esc>h",
	cinf = "console.info()<esc>h",
	cdgb = "console.debug()<esc>h",
	ret = "return ",
	TODO = "// TODO:",
	FIX = "// FIX:",
	NOTE = "// NOTE:",
})

ft_abbr({ "lua" }, {
	pr = 'print("")<esc>h',
	req = 'require("")<esc>h',
})

local abbreviations = utils.merge_tables(typos)
vim.schedule(function()
	for k, v in pairs(abbreviations) do
		vim.cmd(string.format("abbreviate %s %s", k, v))
	end
end)
