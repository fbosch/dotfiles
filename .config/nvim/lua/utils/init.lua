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
