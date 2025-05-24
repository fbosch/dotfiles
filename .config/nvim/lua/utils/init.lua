local M = {}

function M.set_usrcmd(cmd, callback, opts_or_desc)
	opts = opts or {}
	vim.api.nvim_create_user_command(
		cmd,
		callback,
		type(opts_or_desc) == "string" and { desc = opts_or_desc } or (opts_or_desc or {})
	)
end

function M.set_keymap(mode, lhs, rhs, opts_or_desc)
	local opts = vim.tbl_extend(
		"force",
		{ noremap = true, silent = true },
		type(opts_or_desc) == "string" and { desc = opts_or_desc } or (opts_or_desc or {})
	)
	vim.keymap.set(mode, lhs, rhs, opts)
end

function M.project_find_and_replace(pattern, opts)
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
		vim.cmd("copen")
		vim.api.nvim_feedkeys(":cfdo %s/" .. pattern .. "/", "n", false)
	else
		vim.notify("No matches found.", vim.log.levels.INFO)
	end
end

function M.merge_tables(...)
	local merged = {}
	for _, table in ipairs({ ... }) do
		for key, value in pairs(table) do
			merged[key] = value
		end
	end

	return merged
end

return M
