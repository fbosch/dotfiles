local map = vim.api.nvim_set_keymap
local options = { noremap = true }
local silent = { noremap = true, silent = true }

-- disable
map("n", "<Space>", "<NOP>", silent)
map("n", "q", "<NOP>", silent)

-- replace text
map("n", "<leader>ra", ":Sad<CR>", silent)

-- yank
map("n", "<C-a>", "ggVG<CR>", silent)

-- save files
map("n", "<leader>s", ":wa<CR>", silent)
map("n", "<leader>S", ":wqa!<CR>", silent)

-- easier indentation in visual mode
map("v", "<", "<gv", options)
map("v", ">", ">gv", options)

-- autoswitch to newly created split
map("n", "<C-W>v", ":vsplit<CR> <bar> :wincmd l<CR>", silent)
map("n", "<C-W>s", ":split<CR> <bar> :wincmd j<CR>", silent)

-- remap split navigation to CTRL + hjkl
map("n", "<S-h>", ":wincmd h<CR>", silent)
map("n", "<S-j>", ":wincmd j<CR>", silent)
map("n", "<S-k>", ":wincmd k<CR>", silent)
map("n", "<S-l>", ":wincmd l<CR>", silent)

-- remap split manipulation to SHIFT + CTRL + hjkl
map("n", "<C-S-h>", ":wincmd H<CR>", silent)
map("n", "<C-S-j>", ":wincmd J<CR>", silent)

map("n", "<C-S-k>", ":wincmd K<CR>", silent)
map("n", "<C-S-l>", ":wincmd L<CR>", silent)

-- tab controls
-- map("n", "th", ":tabfirst<CR>", options)
-- map("n", "tj", ":tabprev<CR>", options)
-- map("n", "tk", ":tabnext<CR>", options)
-- map("n", "tl", ":tablast<CR>", options)
-- map("n", "tt", ":tabedit<Space>", options)
-- map("n", "tm", ":tabm<Space>", options)
-- map("n", "<C-t>n", ":tabnew<CR>", silent)
-- map("n", "<C-t>d", ":tabclose<CR>", silent)

-- buffer controls
map("n", "<leader>z", ":bp <bar> :bd #<CR>", silent) -- close buffer but keep split
map("n", "<leader>0", ":b#<CR>", silent) --  previously active buffer

-- move lines
map("n", "<A-j>", ":m .+1<CR>==", silent)
map("n", "<A-k>", ":m .-2<CR>==", silent)
map("i", "<A-j>", "<Esc>:m .+1<CR>==gi", silent)
map("i", "<A-k>", "<Esc>:m .-2<CR>==gi", silent)
map("v", "<A-j>", ":m '>+1<CR>gv=gv", silent)
map("v", "<A-k>", ":m '<-2<CR>gv=gv", silent)
