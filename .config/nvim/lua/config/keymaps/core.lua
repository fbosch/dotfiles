local map = require("utils").set_keymap
local vscode = require("utils.vscode")

-- Swap ; and :
map("n", ";", ":")
map("n", ":", ";")
map("x", ":", ";")
map("x", ";", ":")

-- clear search highlights
map("n", "<esc>", ":nohlsearch<CR>", "Clear search highlights")
map("n", "<esc>^[", "<esc>^[", "Clear search highlights")

-- disable arrow keys in insert mode
map("i", "<Up>", "<NOP>")
map("i", "<Down>", "<NOP>")
map("i", "<Left>", "<NOP>")
map("i", "<Right>", "<NOP>")

-- search for the word under the cursor and jump to the next match.
vscode.adaptive_map("n", "<leader>fn", "editor.action.nextMatchFindAction", function()
	local word = vim.fn.expand("<cword>")
	vim.fn.setreg("/", "\\<" .. word .. "\\>")
	vim.cmd("normal! l")
	vim.cmd("normal! n")
	vim.cmd("normal! zz")
end)

-- compare selection with clipboard
map("v", "<leader>dc", "<CMD>DiffClip<CR>", "Compare selection with clipboard")

-- find conflicts
map("n", "<leader>fc", "/<<<<CR>", "Find conflicts")
