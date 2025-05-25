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
	cahnge = "change",
	futher = "further",
	teh = "the",
	seperate = "separate",
	definately = "definitely",
	recieve = "receive",
	occured = "occurred",
	untill = "until",
	adress = "address",
	acheive = "achieve",
	occassion = "occasion",
	intial = "initial",
	sucess = "success",
	sucessful = "successful",
	environment = "environment",
	enviroment = "environment",
	promsie = "promise",
	promse = "promise",
	visiblity = "visibility",
	satic = "static",
	stuct = "struct",
	listner = "listener",
	moduel = "module",
	pakage = "package",
	temproary = "temporary",
	temprary = "temporary",
	cancle = "cancel",
	destory = "destroy",
	histroy = "history",
	requrie = "require",
}

vim.schedule(function()
	for k, v in pairs(typos) do
		vim.cmd(string.format("abbreviate %s %s", k, v))
	end
end)
