local M = {}

function M.find_and_replace(pattern, opts)
	local trouble = require("trouble")
	opts = opts or {}
	local literal = opts.literal ~= false -- default: true (use -F)

	-- Set the 's' register for compatibility with substitute command
	vim.fn.setreg("s", pattern)

	-- Build rg command (use -F for literal, -w for word match if word search)
	local rg_cmd = { "rg", "--vimgrep", "--smart-case" }
	if opts.word then
		table.insert(rg_cmd, "-w")
	end
	if literal then
		table.insert(rg_cmd, "-F")
	end
	table.insert(rg_cmd, pattern)

	local result = vim.fn.systemlist(rg_cmd)
	local qf_list = {}
	for _, line in ipairs(result) do
		local filename, lnum, col, text = line:match("([^:]+):(%d+):(%d+):(.*)")
		if filename then
			table.insert(qf_list, {
				filename = filename,
				lnum = tonumber(lnum),
				col = tonumber(col),
				text = text,
			})
		end
	end
	vim.fn.setqflist(qf_list, "r")
	if #qf_list > 0 then
		trouble.open("quickfix")
		vim.defer_fn(function()
			vim.api.nvim_feedkeys(":cfdo %s/" .. pattern .. "/", "n", false)
		end, 20)
	else
		vim.notify("No matches found.", vim.log.levels.INFO)
	end
end

function M.find_and_replace_word()
	local word = vim.fn.expand("<cword>")
	vim.fn.setreg("v", word)
	M.find_and_replace(word, { word = true })
end

function M.find_and_replace_selection()
	vim.cmd('normal! ""y')
	local selection = vim.fn.getreg('"')
	if not selection or selection == "" then
		vim.notify("No text selected.", vim.log.levels.WARN)
		return
	end
	M.find_and_replace(selection)
end

function M.replace_quickfix_with_trouble()
	local ok, trouble = pcall(require, "trouble")
	if ok then
		vim.cmd("cclose")
		trouble.open("quickfix")
	end
end

return M
