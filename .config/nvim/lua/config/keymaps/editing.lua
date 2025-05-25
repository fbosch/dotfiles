local map = require("utils").set_keymap
local refactor = require("utils.refactor")

-- find and replace
map("n", "<leader>cw", ":%s/<C-R><C-W>//gI<left><left><left>", "Replace words under cursor in buffer") -- in buffer
map("n", "<leader>R", refactor.find_and_replace_word, "Replace word under cursor in project")
map("x", "<leader>R", refactor.find_and_replace_selection, "Replace text selection in project")

-- format buffer
map("n", "<leader>fb", ":lua vim.lsp.buf.format()<CR>", "Format buffer")

-- delete backwards to start of previous line
map("n", "<leader>db", "d?$<cr>", "Delete backwards to start of previous line")

-- save files
map("n", "<leader>s", ":wall<CR>", "Save all files")
map("n", "<leader>S", ":wqa!<CR>", "Save all files and quit")

-- quit
map("n", "<leader>q", ":qa<CR>", "Quit")
map("n", "<leader>Q", ":qa!<CR>", "Quit without saving")

-- easier indentation in visual mode
map("v", "<", "<gv", "Indent left")
map("v", ">", ">gv", "Indent right")

-- move lines
map("n", "<A-j>", ":m .+1<CR>==")
map("n", "<A-k>", ":m .-2<CR>==")
map("i", "<A-j>", "<Esc>:m .+1<CR>==gi")
map("i", "<A-k>", "<Esc>:m .-2<CR>==gi")
map("v", "<A-j>", ":m '>+1<CR>gv=gv")
map("v", "<A-k>", ":m '<-2<CR>gv=gv")
