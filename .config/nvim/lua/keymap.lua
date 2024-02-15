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
map("n", "<S-h>", ":wincmd h<CR>", { silent = true })
map("n", "<S-j>", ":wincmd j<CR>", { silent = true })
map("n", "<S-k>", ":wincmd k<CR>", { silent = true })
map("n", "<S-l>", ":wincmd l<CR>", { silent = true })

-- remap split manipulation to SHIFT + CTRL + hjkl
map("n", "<C-S-h>", ":wincmd H<CR>", silent)
map("n", "<C-S-j>", ":wincmd J<CR>", silent)

map("n", "<C-S-k>", ":wincmd K<CR>", silent)
map("n", "<C-S-l>", ":wincmd L<CR>", silent)

-- tab controls
map("n", "th", ":tabfirst<CR>", options)
map("n", "tj", ":tabprev<CR>", options)
map("n", "tk", ":tabnext<CR>", options)
map("n", "tl", ":tablast<CR>", options)
map("n", "tt", ":tabedit<Space>", options)
map("n", "tm", ":tabm<Space>", options)
map("n", "<C-t>n", ":tabnew<CR>", silent)
-- map("n", "<C-t>d", ":tabclose<CR>", silent)

-- buffer controls
map("n", "<leader>z", ":bp <bar> :bd #<CR>", silent) -- close buffer but keep split
map("n", "<leader>0", ":b#<CR>", silent) --  previously active buffer

-- move lines
map("n", "<A-j>", ":m .+1<CR>==", { noremap = true, silent = true })
map("n", "<A-k>", ":m .-2<CR>==", { noremap = true, silent = true })
map("i", "<A-j>", "<Esc>:m .+1<CR>==gi", { noremap = true, silent = true })
map("i", "<A-k>", "<Esc>:m .-2<CR>==gi", { noremap = true, silent = true })
map("v", "<A-j>", ":m '>+1<CR>gv=gv", { noremap = true, silent = true })
map("v", "<A-k>", ":m '<-2<CR>gv=gv", { noremap = true, silent = true })

-- dap
-- map("n", "<leader>du", ":lua require('dapui').toggle()<CR>", silent)
-- map("n", "<F5>", ":lua require('dap').continue()<CR>", silent)
-- map("n", "<F10>", ":lua require('dap').step_over()<CR>", silent)
-- map("n", "<F11>", ":lua require('dap').step_into()<CR>", silent)
-- map("n", "<F12>", ":lua require('dap').step_out()<CR>", silent)
-- map("n", "<leader>b", ":lua require('dap').toggle_breakpoint()<CR>", silent)
-- map("n", "<leader>B", ":lua require('dap').set_breakpoint(vim.fn.input('Breakpoint condition: '))<CR>", silent)
-- map("n", "<leader>lp", ":lua require('dap').set_breakpoint(nil, nil, vim.fn.input('Log point message: '))<CR>", silent)
-- map("n", "<leader>dr", ":lua require('dap').repl.open()<CR>", silent)
