local api = vim.api
local fn = vim.fn
local fmt = string.format
local log = vim.log.levels

local M = {}

local ft_abbr_group = api.nvim_create_augroup("ConfigFiletypeAbbreviations", { clear = true })

local function normalize_filetypes(filetypes)
	if type(filetypes) == "string" then
		return { filetypes }
	end

	return filetypes
end

local function register_buffer_abbreviations(bufnr, abbreviations)
	if not abbreviations or vim.tbl_isempty(abbreviations) then
		return
	end

	api.nvim_buf_call(bufnr, function()
		for lhs, rhs in pairs(abbreviations) do
			vim.cmd(fmt("iabbrev <buffer> %s %s", lhs, rhs))
		end
	end)
end

function M.ft_abbr(filetypes, abbreviations)
	if not filetypes or not abbreviations then
		return
	end

	api.nvim_create_autocmd("FileType", {
		group = ft_abbr_group,
		pattern = normalize_filetypes(filetypes),
		callback = function(args)
			register_buffer_abbreviations(args.buf, abbreviations)
		end,
	})
end

M.ft_abbr({ "javascript", "javascriptreact", "typescript", "typescriptreact" }, {
	cl = "console.log()<esc>h",
	cdir = "console.dir()<esc>h",
	cer = "console.error()<esc>h",
	cwar = "console.warn()<esc>h",
	cinf = "console.info()<esc>h",
	cdgb = "console.debug()<esc>h",
	ret = "return ",
})

M.ft_abbr({ "lua" }, {
	pr = 'print("")<esc>h',
	req = 'require("")<esc>hi',
	ret = "return ",
})

M.typos = {
	"acheive achieve",
	"adn and",
	"adress address",
	"argu{ement,ments} argument{}",
	"calender calendar",
	"cancle cancel",
	"cahnge change",
	"compar{ision,isons,isno} comparison{}",
	"cosnt const",
	"covert convert",
	"defin{ately,etely,atly,ately} definitely",
	"depend{e,a}nc{ie,ei,y,i}es dependencies",
	"depenedencies dependencies",
	"dont don't",
	"cant can't",
	"wont won't",
	"enviro{n,}ment environment",
	"erros errors",
	"eq{uivalent,ivalent} equivalent",
	"exmaple example",
	"flase false",
	"futher further",
	"funct{ion,ion,oin} function",
	"functino function",
	"fucntion function",
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
	"escpae escape",
	"ne{ccessary,cesary} necessary",
	"occas{sion,ion} occasion",
	"occurr{ance,ence,ed,ed} occurr{ence,ed}",
	"pakage package",
	"purpsoe purpose",
	"sorround surround",
	"desing design",
	"gradeint gradient",
	"persist{ance,ence} persistence{}",
	"plese please",
	"pr{omise,omsie,omse} promise",
	"pubic public",
	"q{uo,ou,uo,uote,oute}te quote",
	-- "rec{ei,ie}ve receive",
	-- "rec{ieve,eived,eiving} receive{}",
	"requ{ire,ier,ieer,iere,rie,re} require",
	"resutl result",
	"retrun return",
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
	"visiblity visibility",
	"purposesly purposesly",
	"una{ail,ial,ali}able unavailable",
	"sensetive sensitive",
	"craete create",
	"visble visible",
}

function M.autofix_typos()
	if fn.exists(":Abolish") == 0 then
		vim.notify("vim-abolish is not available to fix typos", log.WARN)
		return
	end

	for _, entry in ipairs(M.typos) do
		vim.cmd(fmt("Abolish %s", entry))
	end
end

return M
