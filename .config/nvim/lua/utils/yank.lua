local M = {}

function M.to_markdown(content)
	local filename = vim.api.nvim_buf_get_name(0)
	local ext = filename:match("^.+%.([a-zA-Z0-9]+)$") or ""
	local markdown = ("```%s\n%s\n```"):format(ext, content)
	vim.fn.setreg("+", markdown)
end

function M.selection_to_markdown()
	vim.cmd('normal! ""y')
	local content = vim.fn.getreg('"')
	if not content or content == "" then
		print("No selection found.")
		return
	end
	M.to_markdown(content)
	vim.notify(
		"Copied visual selection to clipboard as markdown code block",
		vim.log.levels.INFO,
		{ title = "YankSelectionToMarkdown" }
	)
end

function M.file_to_markdown()
	vim.cmd("%y")
	local content = vim.fn.getreg('"')
	M.to_markdown(content)
	vim.notify(
		"Copied buffer content as markdown code block to clipboard",
		vim.log.levels.INFO,
		{ title = "YankFileToMarkdown" }
	)
end

function M.cursor_diagnostics()
	local pos = vim.api.nvim_win_get_cursor(0)
	local diagnostics = vim.diagnostic.get(0, { lnum = pos[1] - 1 })
	if #diagnostics > 0 then
		local message = diagnostics[1].message
		vim.fn.setreg("+", message) -- System clipboard
		vim.notify("Diagnostics copied to clipboard", vim.log.levels.INFO, { title = "Diagnostics" })
	else
		vim.notify("No diagnostic under cursor.", vim.log.levels.WARN, { title = "Diagnostics" })
	end
end

function M.all_diagnostics()
	local diagnostics = vim.diagnostic.get(0)
	if #diagnostics == 0 then
		vim.notify("No diagnostics in buffer.", vim.log.levels.WARN, { title = "Diagnostics" })
		return
	end

	local messages = {}
	for _, diag in ipairs(diagnostics) do
		table.insert(messages, string.format("[%s:%d] %s", diag.source or "LSP", diag.lnum + 1, diag.message))
	end

	local result = table.concat(messages, "\n")
	vim.fn.setreg("+", result) -- System clipboard

	vim.notify("All diagnostics copied to clipboard", vim.log.levels.INFO, { title = "Diagnostics" })
end

return M
