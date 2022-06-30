local map = vim.keymap.set
local options = { noremap = true }
local silent = { noremap = true, silent = true }

map("n", "<C-p>", "<cmd>lua require('fzf-lua').files()<CR>", silent)
map("n", "<C-e>", ":NvimTreeToggle<CR>", options)
map("n", "<S-d>", ":Sayonara<CR>", silent)

-- easier indentation in visual mode
map("v", "<", "<gv", options)
map("v", ">", ">gv", options)

-- remap split navigation to CTRL + hjkl
map("n", "<C-h> <C-w>", "h", options)
map("n", "<C-j> <C-w>", "j", options)
map("n", "<C-k> <C-w>", "k", options)
map("n", "<C-l> <C-w>", "l", options)

-- adjust split sizes with CTRL + arrows
map("n", "<C-Left>", ":vertical resize +3<CR>", silent)
map("n", "<C-Right>", ":vertical resize -3<CR>", silent)
map("n", "<C-Up>", ":resize -3<CR>", silent)
map("n", "<C-Down>", ":resize +3<CR>", silent)

-- navigate buffers with SHIFT + hl
map("n", "<S-h>", ":BufferPrevious<CR>", silent)
map("n", "<S-l>", ":BufferNext<CR>", silent)

-- find files using telescope
map("n", "<leader>ff", "<cmd>Telescope find_files<CR>", options)
map("n", "<leader>lg", "<cmd>Telescope live_grep<CR>", options)
map("n", "<leader>of", "<cmd>Telescope oldfiles<CR>", options)
map("n", "<leader>fb", "<cmd>Telescope file_browser<CR>", options)
map("n", "<leader>fh", "<cmd>Telescope help_tags<CR>", options)

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
