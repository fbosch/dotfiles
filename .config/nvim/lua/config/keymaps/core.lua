local map = require("utils").set_keymap
local platform = require("utils.platform")

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
map("n", "<leader>fn", function()
	local word = vim.fn.expand("<cword>")
	vim.fn.setreg("/", "\\<" .. word .. "\\>")
	vim.cmd("normal! l")
	vim.cmd("normal! n")
	vim.cmd("normal! zz")
end)

-- compare selection with clipboard
map("v", "<leader>dc", "<CMD>DiffClip<CR>", "Compare selection with clipboard")

map("n", "<leader>br", function()
	if vim.fn.confirm("Reload current buffer and discard unsaved changes?", "&Yes\n&No", 2) == 1 then
		vim.cmd("edit!")
	end
end, "Reload buffer and discard changes")

-- find conflicts
map("n", "<leader>fc", "/<<<<CR>", "Find conflicts")

-- open the current file with the system's default application
map("n", "<leader>of", function()
	local path = vim.api.nvim_buf_get_name(0)
	if path == "" then
		vim.notify("Current buffer has no file path", vim.log.levels.WARN)
		return
	end
	platform.system_open(path)
end, "Open current file with system application")
