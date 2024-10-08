local map = vim.api.nvim_set_keymap
local opts = { noremap = true, silent = true }

-- disable
map("n", "<Space>", "<NOP>", opts)

map("v", "<leader>dc", "<CMD>DiffClip<CR>", opts)

-- disable arrow keys in insert mode
map("i", "<Up>", "<NOP>", opts)
map("i", "<Down>", "<NOP>", opts)
map("i", "<Left>", "<NOP>", opts)
map("i", "<Right>", "<NOP>", opts)

-- increment and decrement
map("n", "+", "<C-a>", opts)
map("n", "-", "<C-x>", opts)

-- yank
map("n", "<C-a>", "ggVG<CR>", opts)
-- paste last thing yanked(not system copied), not deleted
map("n", ",p", '"0p', opts)
map("n", ",P", '"0P', opts)
-- yank current file
map("n", "<leader>yf", ":%y<cr>", opts)

-- replace words under cursor
map("n", "<leader>rw", ":%s/<C-R><C-W>//gI<left><left><left>", opts) -- in buffer
map("n", "<leader>rW", ":s/<C-R><C-W>//gI<left><left><left>", opts) -- on line

-- save files
map("n", "<leader>s", ":wall<CR>", opts)
map("n", "<leader>S", ":wqa!<CR>", opts)

-- easier indentation in visual mode
map("v", "<", "<gv", opts)
map("v", ">", ">gv", opts)

-- format
map("n", "<leader>fb", ":lua vim.lsp.buf.format()<CR>", opts)

-- move lines
map("n", "<A-j>", ":m .+1<CR>==", opts)
map("n", "<A-k>", ":m .-2<CR>==", opts)
map("i", "<A-j>", "<Esc>:m .+1<CR>==gi", opts)
map("i", "<A-k>", "<Esc>:m .-2<CR>==gi", opts)
map("v", "<A-j>", ":m '>+1<CR>gv=gv", opts)
map("v", "<A-k>", ":m '<-2<CR>gv=gv", opts)

-- auto switch to newly created splits
map("n", "<C-W>v", ":vsplit<CR> <bar> :wincmd l<CR>", opts)
map("n", "<C-W>s", ":split<CR> <bar> :wincmd j<CR>", opts)

-- remap split navigation to CTRL + hjkl
map("n", "<S-h>", ":wincmd h<CR>", opts)
map("n", "<S-j>", ":wincmd j<CR>", opts)
map("n", "<S-k>", ":wincmd k<CR>", opts)
map("n", "<S-l>", ":wincmd l<CR>", opts)

-- remap split manipulation to SHIFT + CTRL + hjkl
map("n", "<C-S-h>", ":wincmd H<CR>", opts)
map("n", "<C-S-j>", ":wincmd J<CR>", opts)
map("n", "<C-S-k>", ":wincmd K<CR>", opts)
map("n", "<C-S-l>", ":wincmd L<CR>", opts)

-- buffer controls
map("n", "<leader>z", ":bp <bar> :bd #<CR>", opts) -- close buffer but keep split
map("n", "<leader>0", ":b#<CR>", opts) --  previously active buffer

-- delete backwards to start of previous line
map("n", "<leader>db", "d?$<cr>", opts)
