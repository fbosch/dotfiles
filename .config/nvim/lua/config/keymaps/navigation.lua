local map = require("utils").set_keymap

-- navigate to the next issue in the current file
map("n", "<leader>in", function()
	vim.diagnostic.jump({
		count = 1,
		severity_limit = vim.diagnostic.severity.ERROR,
	})
	vim.cmd("normal! zz")
end, "Navigate to the next issue in the current buffer")

-- navigate to the previous issue in the current file
map("n", "<leader>ip", function()
	vim.diagnostic.jump({
		count = -1,
		severity_limit = vim.diagnostic.severity.ERROR,
	})
	vim.cmd("normal! zz")
end, "Navigate to the previous issue in the current buffer")

-- remap split manipulation to SHIFT + CTRL + hjkl
map("n", "<C-S-h>", ":wincmd H<CR>")
map("n", "<C-S-j>", ":wincmd J<CR>")
map("n", "<C-S-k>", ":wincmd K<CR>")
map("n", "<C-S-l>", ":wincmd L<CR>")

-- buffer controls
map("n", "<leader>bd", ":bp <bar> :bd #<CR>", "Close buffer but keep split") -- close buffer but keep split
map("n", "<leader>0", ":b#<CR>", "Go to previoulsy active buffer") --  previously active buffer

local vscode = require("utils.vscode")

-- auto switch to newly created splits
vscode.adaptive_map("n", "<C-W>v", "workbench.action.splitEditor", ":vsplit<CR> <bar> :wincmd l<CR>")
vscode.adaptive_map("n", "<C-W>s", "workbench.action.splitEditorDown", ":split<CR> <bar> :wincmd j<CR>")

-- split navigation (Shift+h/j/k/l)
vscode.adaptive_map("n", "<S-h>", "workbench.action.focusPreviousGroup", ":wincmd h<CR>")
vscode.adaptive_map("n", "<S-j>", "workbench.action.focusNextGroup", ":wincmd j<CR>")
vscode.adaptive_map("n", "<S-k>", "workbench.action.focusPreviousGroup", ":wincmd k<CR>")
vscode.adaptive_map("n", "<S-l>", "workbench.action.focusNextGroup", ":wincmd l<CR>")
