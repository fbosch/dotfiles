local M = {}

function M.call(cmd)
	return ":lua require('vscode').call('" .. cmd .. "')<CR>"
end

function M.adaptive_map(mode, lhs, vscode_cmd, nvim_cmd)
	vim.keymap.set(mode, lhs, vim.g.vscode and M.call(vscode_cmd) or nvim_cmd, { silent = true })
end

return M
