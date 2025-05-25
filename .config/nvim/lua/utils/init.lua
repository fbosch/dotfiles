local M = {}

function M.load_highlights(group)
	for hl, color in pairs(group) do
		vim.api.nvim_set_hl(0, hl, color)
	end
end

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

function M.wipe_all_sessions()
	local root_dir = vim.fn.expand("~/.config/nvim/.sessions")
	local ok, err = pcall(function()
		-- Recursively delete the directory
		vim.fn.delete(root_dir, "rf")
	end)

	if ok then
		vim.notify("Wiped all sessions", vim.log.levels.INFO, {
			title = "AutoSession",
		})
	else
		vim.notify("Failed to wipe sessions: " .. tostring(err), vim.log.levels.ERROR, {
			title = "AutoSession",
		})
	end
end

function M.get_visual_selection_lines(bufnr)
	bufnr = bufnr or vim.api.nvim_get_current_buf()
	local mode = vim.fn.mode()
	if mode ~= "v" and mode ~= "V" then
		return nil
	end
	local start = vim.fn.getpos("'<")
	local finish = vim.fn.getpos("'>")
	local lines = vim.api.nvim_buf_get_lines(bufnr, start[2] - 1, finish[2], false)
	-- If visual mode is characterwise, trim first and last lines
	if mode == "v" and #lines > 0 then
		lines[1] = lines[1]:sub(start[3])
		lines[#lines] = lines[#lines]:sub(1, finish[3])
	end
	return lines
end

return M
