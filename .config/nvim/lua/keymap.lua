local map = vim.keymap.set
local options = { noremap = true }
local silent = { noremap = true, silent = true }

map("n", "<C-p>", "<cmd>lua require('fzf-lua').files()<CR>", silent)
map("n", "<C-b>", ":NvimTreeToggle<CR>", options)
map("n", "<leader>z", ":Sayonara!<CR>", silent)

-- easier indentation in visual mode
map("v", "<", "<gv", options)
map("v", ">", ">gv", options)

-- clear highlighted search with Escape in normal mode
map("n", "<Esc>", ":noh<CR>", silent)
map("n", "<esc>^[", "<esc>[", silent)

-- remap split navigation to CTRL + hjkl
map("n", "<C-k>", ":wincmd k<CR>", silent)
map("n", "<C-j>", ":wincmd j<CR>", silent)
map("n", "<C-h>", ":wincmd h<CR>", silent)
map("n", "<C-l>", ":wincmd l<CR>", silent)

-- autoswitch to newly created split
map("n", "<C-W>v", ":vsplit<CR> | :wincmd l<CR>", silent)
map("n", "<C-W>s", ":split<CR> | :wincmd j<CR>", silent)

-- adjust split sizes with CTRL + arrows
map("n", "<C-Left>", ":vertical resize +3<CR>", silent)
map("n", "<C-Right>", ":vertical resize -3<CR>", silent)
map("n", "<C-Up>", ":resize -3<CR>", silent)
map("n", "<C-Down>", ":resize +3<CR>", silent)

-- navigate buffers with SHIFT + hl
map("n", "<S-h>", ":BufferPrevious<CR>", silent)
map("n", "<S-l>", ":BufferNext<CR>", silent)

-- find files using telescope
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
map("n", "<C-t>1", "1gt", silent)
map("n", "<C-t>2", "2gt", silent)
map("n", "<C-t>3", "3gt", silent)
map("n", "<C-t>4", "4gt", silent)
map("n", "<C-t>5", "5gt", silent)
map("n", "<C-t>6", "6gt", silent)
map("n", "<C-t>7", "7gt", silent)
map("n", "<C-t>8", "8gt", silent)
map("n", "<C-t>9", "9gt", silent)

-- disable
map("n", "<Space>", "<NOP>", silent)
map("n", "q", "<NOP>", silent)

-- trouble toggling
map("n", "<leader>xx", "<cmd>Trouble<CR>", silent)
map("n", "<leader>xw", "<cmd>Trouble workspace_diagnostics<CR>", silent)
map("n", "<leader>xd", "<cmd>Trouble document_diagnostics<CR>", silent)
map("n", "<leader>xl", "<cmd>Trouble loclist<CR>", silent)
map("n", "<leader>xq", "<cmd>Trouble quickfix<CR>", silent)
map("n", "gR", "<cmd>Trouble lsp_references<CR>", silent)
