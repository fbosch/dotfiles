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

return M
