local map = require("utils").set_keymap
local refactor = require("utils.refactor")

local function select_node(target, lsp_direction)
	if vim.treesitter.get_parser(nil, nil, { error = false }) then
		vim.treesitter.select(target, vim.v.count1)
		return
	end

	vim.lsp.buf.selection_range(lsp_direction * vim.v.count1)
end

-- find and replace
map("n", "<leader>cw", ":%s/<C-R><C-W>//gI<left><left><left>", "Replace words under cursor in buffer") -- in buffer
map("n", "<leader>R", refactor.find_and_replace_word, "Replace word under cursor in project")
map("x", "<leader>R", refactor.find_and_replace_selection, "Replace text selection in project")

-- format buffer
map("n", "<leader>fb", ":lua vim.lsp.buf.format()<CR>", "Format buffer")

-- delete backwards to start of previous line
map("n", "<leader>db", "d?$<cr>", "Delete backwards to start of previous line")

-- save files
map("n", "<leader>s", ":wall<CR>")
map("n", "<leader>S", ":wqa!<CR>", "Save all files and quit")

-- easier indentation in visual mode
map("v", "<", "<gv", "Indent left")
map("v", ">", ">gv", "Indent right")

-- Incrementally select treesitter nodes (built into Neovim 0.12+)
map("x", "v", function()
	select_node("parent", 1)
end, "Increment treesitter selection")
map("x", "V", function()
	select_node("child", -1)
end, "Decrement treesitter selection")

-- Keep direct Alt bindings available to Herdr.
map("n", "<C-A-S-Down>", ":m .+1<CR>==")
map("n", "<C-A-S-Up>", ":m .-2<CR>==")
map("i", "<C-A-S-Down>", "<Esc>:m .+1<CR>==gi")
map("i", "<C-A-S-Up>", "<Esc>:m .-2<CR>==gi")
map("v", "<C-A-S-Down>", ":m '>+1<CR>gv=gv")
map("v", "<C-A-S-Up>", ":m '<-2<CR>gv=gv")
