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
map("n", "<leader>iN", function()
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

-- auto switch to newly created splits
map("n", "<C-W>v", ":vsplit<CR> <bar> :wincmd l<CR>")
map("n", "<C-W>s", ":split<CR> <bar> :wincmd j<CR>")

-- split navigation (Shift+h/j/k/l)
map("n", "<S-h>", ":wincmd h<CR>")
map("n", "<S-j>", ":wincmd j<CR>")
map("n", "<S-k>", ":wincmd k<CR>")
map("n", "<S-l>", ":wincmd l<CR>")
