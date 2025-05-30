local map = require("utils").set_keymap

-- disable key that is used as leader
map("n", "<Space>", "<NOP>")

-- Swap ; and :
map("n", ";", ":")
map("n", ":", ";")
map("x", ":", ";")
map("x", ";", ":")

-- remap nordic key layout in normal mode, to minimize how often I have to toggle between keyboard layouts
map("n", "æ", ":")
map("n", "ø", "'")
map("n", "å", "[")
map("n", "¨", "]")
map("x", "æ", ":")
map("x", "ø", "'")
map("x", "å", "[")
map("x", "¨", "]")
map("n", "-", "/")

-- clear search highlights
map("n", "<esc>", ":nohlsearch<CR>", "Clear search highlights")
map("n", "<esc>^[", "<esc>^[", "Clear search highlights")

-- disable arrow keys in insert mode
map("i", "<Up>", "<NOP>")
map("i", "<Down>", "<NOP>")
map("i", "<Left>", "<NOP>")
map("i", "<Right>", "<NOP>")

-- search for the word under the cursor and jump to the next match.
map("n", "<leader>fn", function()
	local word = vim.fn.expand("<cword>")
	vim.fn.setreg("/", "\\<" .. word .. "\\>")
	vim.cmd("normal! l")
	vim.cmd("normal! n")
	vim.cmd("normal! zz")
end, "Find next occurrence of word under cursor")

-- compare selection with clipboard
map("v", "<leader>dc", "<CMD>DiffClip<CR>", "Compare selection with clipboard")

-- find conflicts
map("n", "<leader>fc", "/<<<<CR>", "Find conflicts")
