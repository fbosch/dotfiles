local map = vim.keymap.set
local options = { noremap = true }
local silent = { noremap = true, silent = true }

-- disable
map("n", "<Space>", "<NOP>", silent)
map("n", "q", "<NOP>", silent)

-- fzf
map(
  "n",
  "<C-p>",
  ":lua require('fzf-lua').files({ cmd = 'rg --files --follow --no-ignore-vcs --hidden -g \"!{**/node_modules/*,**/.git/*,**/.yarn/*,**/dist/*}\" --no-heading --smart-case' })<CR>",
  silent
)
map("n", "<leader>gf", ":lua require('fzf-lua').git_files()<CR>", silent)
map(
  "n",
  "<leader>lg",
  ":lua require('fzf-lua').live_grep({ rg_glob = true, glob_flag = \"--iglob\", exec_empty_query = true, rg_opts = '--hidden --no-ignore -g \"!{**/node_modules/*,**/.git/*,**/.yarn/*,**/dist/*}\" --smart-case --no-heading' })<CR>",
  options
)
map("n", "<leader>b", ":lua require('fzf-lua').buffers()<CR>", options)
map("n", "<leader>of", ":lua require('fzf-lua').oldfiles()<CR>", options)

-- misc
map("n", "<leader>m", ":Mason<CR>", silent)
map("n", "<leader>ra", ":Sad<CR>", silent)
map("n", "<leader>pc", ":CccPick<CR>", silent)
map("n", "<leader>wk", ":WhichKey<CR>", silent)

-- yank
map("n", "<C-a>", "ggVG<CR>", silent)
map("n", "<leader>pc", ":let @+=expand('%:p')<CR>", silent)

-- float term
map("n", "<leader>ft", ":FloatermToggle<CR>", silent)

-- pick window
map("n", "<leader>p", function()
  local winpick = require("winpick")
  local winid = winpick.select()

  if winid then
    vim.api.nvim_set_current_win(winid)
  end
end, silent)

-- glance
map("n", "<leader>gD", ":Glance definitions<CR>", silent)
map("n", "<leader>gR", ":Glance references<CR>", silent)

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

-- overseer
map("n", "<leader>ot", ":OverseerToggle<CR>", silent)
map("n", "<leader>or", ":OverseerRun<CR>", silent)
map("n", "<leader>od", ":OverseerLoadBundle dev<CR>", silent)

-- git
map("n", "<leader>gbo", ":GitBlameOpenCommitURL<CR>", silent)
map("n", "<leader>gbc", ":GitBlameCopySHA<CR>", silent)
map("n", "<leader>gg", ":LazyGit<CR>", silent)

-- worktrees
map("n", "<leader>wt", ":lua require('telescope').extensions.git_worktree.git_worktrees()<CR>", silent)
map("n", "<leader>awt", ":lua require('telescope').extensions.git_worktree.create_git_worktree()<CR>", silent)

-- history
map("n", "<leader>e", ":NvimTreeToggle<CR>", silent)
map("n", "<leader>ff", ":NvimTreeFindFile<CR>", silent)
map("n", "<leader>uu", ":UndotreeToggle<CR>", silent)
map("n", "<leader>dff", ":DiffviewOpen<CR>", silent)
map("n", "<leader>dfq", ":DiffviewClose<CR>", silent)

-- save files
map("n", "<leader>s", ":wa<CR>", silent)
map("n", "<leader>S", ":wqa!<CR>", silent)

-- move lines with move.nvim using Alt + hjkl
map("n", "<A-j>", ":MoveLine(1)<CR>", silent)
map("n", "<A-k>", ":MoveLine(-1)<CR>", silent)
map("v", "<A-j>", ":MoveBlock(1)<CR>", silent)
map("v", "<A-k>", ":MoveBlock(-1)<CR>", silent)
map("n", "<A-l>", ":MoveHChar(1)<CR>", silent)
map("n", "<A-h>", ":MoveHChar(-1)<CR>", silent)
map("v", "<A-l>", ":MoveHBlock(1)<CR>", silent)
map("v", "<A-l>", ":MoveHBlock(-1)<CR>", silent)

-- easier indentation in visual mode
map("v", "<", "<gv", options)
map("v", ">", ">gv", options)

-- find and replace all
-- map("n", "S", ":%s//<Left>", silent)

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

-- autoswitch to newly created split
map("n", "<C-W>v", ":vsplit<CR> <bar> :wincmd l<CR>", silent)

map("n", "<C-W>s", ":split<CR> <bar> :wincmd j<CR>", silent)

-- adjust split sizes with CTRL + arrows
-- map("n", "<C-Left>", ":vertical resize +3<CR>", silent)
map("n", "<C-Left>", ":SmartResizeLeft<CR>", silent)
-- map("n", "<C-Right>", ":vertical resize -3<CR>", silent)
map("n", "<C-Right>", ":SmartResizeRight<CR>", silent)
-- map("n", "<C-Up>", ":resize -3<CR>", silent)
map("n", "<C-Up>", ":SmartResizeUp<CR>", silent)
-- map("n", "<C-Down>", ":resize +3<CR>", silent)
map("n", "<C-Down>", ":SmartResizeDown<CR>", silent)

-- tab controls
map("n", "th", ":tabfirst<CR>", options)
map("n", "tj", ":tabprev<CR>", options)
map("n", "tk", ":tabnext<CR>", options)
map("n", "tl", ":tablast<CR>", options)
map("n", "tt", ":tabedit<Space>", options)
map("n", "tm", ":tabm<Space>", options)
map("n", "<C-t>n", ":tabnew<CR>", silent)
map("n", "<C-t>d", ":tabclose<CR>", silent)

-- buffer controls
map("n", "<leader>z", ":bp <bar> :bd #<CR>", silent) -- close buffer but keep split
map("n", "-", ":b#<CR>", silent)                     --  previously active buffer

-- barbar buffer controls
map("n", "<leader>x", ":only <bar> :BufferCloseAllButCurrentOrPinned<CR>", silent) -- close all buffers except current
map("n", "<leader>P", ":BufferPin<CR>", silent)                                    -- pin current buffer
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

-- trouble toggling
map("n", "<leader>tx", ":Trouble<CR>", silent)
map("n", "<leader>tw", ":Trouble workspace_diagnostics<CR>", silent)
map("n", "<leader>td", ":Trouble document_diagnostics<CR>", silent)
map("n", "<leader>tt", ":TodoTrouble<CR>", silent)
map("n", "<leader>tl", ":Trouble loclist<CR>", silent)
map("n", "<leader>tq", ":Trouble quickfix<CR>", silent)
map("n", "<leader>tr", ":Trouble lsp_references<CR>", silent)
map("n", "<leader>tz", ":TroubleClose<CR>", silent)

-- hop bindings
map("n", "<leader>h", ":HopWord<CR>", silent)
map("n", "<leader>cl", ":HopWordCurrentLine<CR>", silent)
map("n", "<leader>lh", ":HopLineStart<CR>", silent)
map("n", "<leader>la", ":HopLineStartAC<CR>", silent)
map("n", "<leader>lb", ":HopLineStartBC<CR>", silent)
map("n", "<leader>vh", ":HopVertical<CR>", silent)
