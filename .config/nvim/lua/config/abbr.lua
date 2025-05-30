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
	ret = "return ",
})

local typos = {
	"enviro{n,}ment environment",
	"proms{e,ie} promise",
	"succes{,sful} success{}",
	"tempor{ary,ry} temporary",
	"occas{sion,ion} occasion",
	"occurr{ance,ence,ed,ed} occurr{ence,ed}",
	"init{ial,ialize,ialized,ialize} init{ial,ialize,ialized,ialize}",
	"depend{e,a}nc{ie,ei,y,i}es dependencies",
	"se{p,e}rate separate",
	"funct{ion,ion,oin} function",
	"defin{ately,etely,atly,ately} definitely",
	"q{uo,ou,uo,uote,oute}te quote",
	"cahnge change",
	"futher further",
	"intial initial",
	"teh the",
	"adn and",
	"hte the",
	"teh the",
	"rec{ei,ie}ve receive",
	"requ{ire,ier,ieer,iere,rie,ere} require",
	"r{e,eq,qui,quiq,quir,quire} require",
	"untill until",
	"adress address",
	"acheive achieve",
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
