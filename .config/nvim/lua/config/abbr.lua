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
	"acheive achieve",
	"adn and",
	"adress address",
	"argu{ement,ments} argument{}",
	"calender calendar",
	"cancle cancel",
	"cahnge change",
	"compar{ision,isons} comparison{}",
	"covert convert",
	"defin{ately,etely,atly,ately} definitely",
	"depend{e,a}nc{ie,ei,y,i}es dependencies",
	"dont don't",
	"enviro{n,}ment environment",
	"erros errors",
	"eq{uivalent,ivalent} equivalent",
	"exmaple example",
	"flase false",
	"futher further",
	"funct{ion,ion,oin} function",
	"hieght height",
	"histroy history",
	"hte the",
	"ident{ifer,ifers} identifier{}",
	"importn{t,at} important",
	"init{ial,ialize,ialized,ialize} init{ial,ialize,ialized,ialize}",
	"intial initial",
	"lenght length",
	"lib{ary,aries} library{}",
	"listner listener",
	"moduel module",
	"ne{ccessary,cesary} necessary",
	"occas{sion,ion} occasion",
	"occurr{ance,ence,ed,ed} occurr{ence,ed}",
	"pakage package",
	"sorround surround",
	"persist{ance,ences} persistence",
	"plese please",
	"pr{omise,omsie,omse} promise",
	"pubic public",
	"q{uo,ou,uo,uote,oute}te quote",
	"rec{ei,ie}ve receive",
	"rec{ieve,eived,eiving} receive{}",
	"requ{ire,ier,ieer,iere,rie,ere} require",
	"resutl result",
	"retrun return",
	"r{e,eq,qui,quiq,quir,quire} require",
	"se{p,e}rate separate",
	"satic static",
	"self self",
	"statuc static",
	"stirng string",
	"stuct struct",
	"succes{,sful} success{}",
	"sytem system",
	"teh the",
	"tempor{ary,ry} temporary",
	"thorw throw",
	"truw true",
	"unkown unknown",
	"untill until",
	"valud valid",
	"variabel variable",
	"visiblity visibility",
}

-- utilize vim-abolish for common typos
vim.schedule(function()
	for _, v in pairs(typos) do
		vim.cmd(string.format("Abolish %s", v))
	end
end)
