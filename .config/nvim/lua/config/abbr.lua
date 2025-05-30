local function ft_abbr(filetypes, abbr)
	return vim.api.nvim_create_autocmd({ "FileType" }, {
		pattern = pattern,
		callback = function()
			vim.schedule(function()
				for k, v in pairs(abbr) do
					vim.cmd(string.format("abbreviate %s %s", k, v))
				end
			end)
		end,
	})
end

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
	req = 'require("")<esc>hi',
})

local typos = {
	"enviro{n,}ment environment",
	"proms{e,ie} promise",
	"succes{,sful} success{}",
	"tempor{ary,ry} temporary",
	"occas{sion,ion} occasion",
	"oc{cur,cu}red occurred",
	"cahnge change",
	"futher further",
	"teh the",
	"se{p,e}rate separate",
	"definat{e,ely,ly} definitely",
	"rec{ei,ie}ve receive",
	"requir{e,er,} require",
	"untill until",
	"adress address",
	"acheive achieve",
	"intial initial",
	"visiblity visibility",
	"satic static",
	"stuct struct",
	"listner listener",
	"moduel module",
	"pakage package",
	"cancle cancel",
	"destory destroy",
	"histroy history",
}

-- utilize vim-abolish for common typos
vim.schedule(function()
	for _, v in pairs(typos) do
		vim.cmd(string.format("Abolish %s", v))
	end
end)
