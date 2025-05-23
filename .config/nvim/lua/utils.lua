local M = {}

function M.vscode_call(cmd)
	return ":lua require('vscode').call('" .. cmd .. "')<CR>"
end

function M.set_keymap(mode, lhs, rhs, opts_or_desc)
	local opts = vim.tbl_extend(
		"force",
		{ noremap = true, silent = true },
		type(opts_or_desc) == "string" and { desc = opts_or_desc } or (opts_or_desc or {})
	)
	vim.keymap.set(mode, lhs, rhs, opts)
end

function M.vscode_adaptive_map(mode, lhs, vscode_cmd, nvim_cmd)
	vim.keymap.set(mode, lhs, vim.g.vscode and M.vscode_call(vscode_cmd) or nvim_cmd)
end

return M
