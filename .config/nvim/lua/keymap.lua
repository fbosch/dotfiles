local map = vim.api.nvim_set_keymap
local opts = { noremap = true, silent = true }

-- disable
map("n", "<Space>", "<NOP>", opts)
map("n", "q", "<NOP>", opts)

-- replace text
map("n", "<leader>ra", ":Sad<CR>", opts)

-- increment and decrement
map("n", "+", "<C-a>", opts)
map("n", "-", "<C-x>", opts)

-- yank
map("n", "<C-a>", "ggVG<CR>", opts)

-- save files
map("n", "<leader>s", ":wa<CR>", opts)
map("n", "<leader>S", ":wqa!<CR>", opts)

-- easier indentation in visual mode
map("v", "<", "<gv", opts)
map("v", ">", ">gv", opts)

-- autoswitch to newly created split
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

-- tab controls
-- map("n", "th", ":tabfirst<CR>", opts)
-- map("n", "tj", ":tabprev<CR>", opts)
-- map("n", "tk", ":tabnext<CR>", opts)
-- map("n", "tl", ":tablast<CR>", opts)
-- map("n", "tt", ":tabedit<Space>", opts)
-- map("n", "tm", ":tabm<Space>", opts)
-- map("n", "<C-t>n", ":tabnew<CR>", opts)
-- map("n", "<C-t>d", ":tabclose<CR>", opts)

-- buffer controls
map("n", "<leader>z", ":bp <bar> :bd #<CR>", opts) -- close buffer but keep split
map("n", "<leader>0", ":b#<CR>", opts) --  previously active buffer

-- move lines
map("n", "<A-j>", ":m .+1<CR>==", opts)
map("n", "<A-k>", ":m .-2<CR>==", opts)
map("i", "<A-j>", "<Esc>:m .+1<CR>==gi", opts)
map("i", "<A-k>", "<Esc>:m .-2<CR>==gi", opts)
map("v", "<A-j>", ":m '>+1<CR>gv=gv", opts)
map("v", "<A-k>", ":m '<-2<CR>gv=gv", opts)
