local map = vim.keymap.set
local options = { noremap = true }
local silent = { noremap = true, silent = true }

map("n", "<C-p>", ":lua require('fzf-lua').files()<CR>", silent)
map("n", "<Leader>e", ":NvimTreeToggle<CR>", silent)

-- easier indentation in visual mode
map("v", "<", "<gv", options)
map("v", ">", ">gv", options)

-- clear highlighted search with Escape in normal mode
map("n", "<Esc>", ":noh<CR>", silent)
map("n", "<esc>^[", "<esc>[", silent)

-- remap split navigation to CTRL + hjkl
map("n", "<S-k>", ":wincmd k<CR>", silent)
map("n", "<S-j>", ":wincmd j<CR>", silent)
map("n", "<S-h>", ":wincmd h<CR>", silent)
map("n", "<S-l>", ":wincmd l<CR>", silent)

-- autoswitch to newly created split
map("n", "<C-W>v", ":vsplit<CR> <bar> :wincmd l<CR>", silent)
map("n", "<C-W>s", ":split<CR> <bar> :wincmd j<CR>", silent)

-- adjust split sizes with CTRL + arrows
map("n", "<C-Left>", ":vertical resize +3<CR>", silent)
map("n", "<C-Right>", ":vertical resize -3<CR>", silent)
map("n", "<C-Up>", ":resize -3<CR>", silent)
map("n", "<C-Down>", ":resize +3<CR>", silent)

-- telescope
map("n", "<Leader>ff", ":Telescope find_files<CR>", options)
map("n", "<Leader>lg", ":Telescope live_grep<CR>", options)
map("n", "<Leader>of", ":Telescope oldfiles<CR>", options)
map("n", "<Leader>fb", ":Telescope file_browser<CR>", options)
map("n", "<Leader>fh", ":Telescope help_tags<CR>", options)

-- tab controls
map("n", "th", ":tabfirst<CR>", options)
map("n", "tk", ":tabnext<CR>", options)
map("n", "tj", ":tabprev<CR>", options)
map("n", "tl", ":tablast<CR>", options)
map("n", "tt", ":tabedit<Space>", options)
map("n", "tm", ":tabm<Space>", options)
map("n", "<C-t>n", ":tabnew<CR>", silent)
map("n", "<C-t>d", ":tabclose<CR>", silent)

-- buffer controls
map("n", "<leader>z", ":bp <bar> :bd #<CR>", silent) -- close buffer but keep split
map("n", "-", ":b#<CR>", silent) --  previously active buffer
-- barbar buffer controls
map("n", "<leader>x", ":only <bar> :BufferCloseAllButCurrentOrPinned<CR>", silent) -- close all buffers except current
map("n", "<leader>p", ":BufferPin<CR>", silent) -- pin current buffer
map("n", "<C-h>", ":BufferPrevious<CR>", silent)
map("n", "<C-l>", ":BufferNext<CR>", silent)
map("n", "<C-A-h>", ":BufferMovePrevious<CR>", silent)
map("n", "<C-A-l>", ":BufferMoveNext<CR>", silent)
map("n", "<C-1>", ":BufferGoto 1<CR>", silent)
map("n", "<C-2>", ":BufferGoto 2<CR>", silent)
map("n", "<C-3>", ":BufferGoto 3<CR>", silent)
map("n", "<C-4>", ":BufferGoto 4<CR>", silent)
map("n", "<C-5>", ":BufferGoto 5<CR>", silent)
map("n", "<C-6>", ":BufferGoto 6<CR>", silent)
map("n", "<C-7>", ":BufferGoto 7<CR>", silent)
map("n", "<C-8>", ":BufferGoto 8<CR>", silent)
map("n", "<C-9>", ":BufferGoto 9<CR>", silent)

-- disable
map("n", "<Space>", "<NOP>", silent)
map("n", "q", "<NOP>", silent)

-- trouble toggling
map("n", "<leader>tx", "<cmd>Trouble<CR>", silent)
map("n", "<leader>tw", "<cmd>Trouble workspace_diagnostics<CR>", silent)
map("n", "<leader>td", "<cmd>Trouble document_diagnostics<CR>", silent)
map("n", "<leader>tl", "<cmd>Trouble loclist<CR>", silent)
map("n", "<leader>tq", "<cmd>Trouble quickfix<CR>", silent)
map("n", "gR", "<cmd>Trouble lsp_references<CR>", silent)


