local api = vim.api
local fn = vim.fn
local fmt = string.format
local log = vim.log.levels

local M = {}
local config_home = fn.fnamemodify(fn.stdpath("config"), ":h")
package.path = config_home .. "/fbb/lua/?.lua;" .. package.path
local paths = require("fbb.paths")
local typo_rules_path = paths.data_path("typos.abolish", config_home)

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

local function read_typo_rules()
	if fn.filereadable(typo_rules_path) == 0 then
		vim.notify(fmt("typo rules file is not readable: %s", typo_rules_path), log.WARN)
		return {}
	end

	local rules = {}
	for _, line in ipairs(fn.readfile(typo_rules_path)) do
		local trimmed = vim.trim(line)
		if trimmed ~= "" and not vim.startswith(trimmed, "#") then
			table.insert(rules, trimmed)
		end
	end

	return rules
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

M.typos = read_typo_rules()

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
