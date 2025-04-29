local base_opts = { noremap = true, silent = true }
local function map(mode, lhs, rhs, desc)
	local opts = vim.tbl_extend("force", base_opts, desc and { desc = desc } or {})
	vim.keymap.set(mode, lhs, rhs, opts)
end

-- disable
map("n", "<Space>", "<NOP>")

-- Swap ; and :
map("n", ":", ";")
map("n", ";", ":")
map("x", ":", ";")
map("x", ";", ":")

-- compare selection with clipboard
map("v", "<leader>dc", "<CMD>DiffClip<CR>", "Compare selection with clipboard")

-- Clear search highlights
map("n", "<esc>", ":nohlsearch<CR>", "Clear search highlights")
map("n", "<esc>^[", "<esc>^[", "Clear search highlights")

-- find conflicts
map("n", "<leader>fc", "/<<<<CR>", "Find conflicts")

-- disable arrow keys in insert mode
map("i", "<Up>", "<NOP>")
map("i", "<Down>", "<NOP>")
map("i", "<Left>", "<NOP>")
map("i", "<Right>", "<NOP>")

-- increment and decrement
map("n", "+", "<C-a>", "Increment")
map("n", "-", "<C-x>", "Decrement")

-- yank
map("n", "<C-a>", "ggVG<CR>", "Select all")

-- paste last thing yanked (not system copied), not deleted
map("n", ",p", '"0p')
map("n", ",P", '"0P')

-- Don't yank on put
map("x", "p", '"_dP')

-- yank current file
map("n", "<leader>yf", ":%y<cr>", "Yank current file")

-- replace words under cursor
map("n", "<leader>rw", ":%s/<C-R><C-W>//gI<left><left><left>", "Replace words under cursor in buffer") -- in buffer
map("n", "<leader>rW", ":s/<C-R><C-W>//gI<left><left><left>", "Replace words under cursor on line") -- on line

-- save files
map("n", "<leader>s", ":wall<CR>", "Save all files")
map("n", "<leader>S", ":wqa!<CR>", "Save all files and quit")

-- quit
map("n", "<leader>q", ":qa<CR>", "Quit")
map("n", "<leader>Q", ":qa!<CR>", "Quit without saving")

-- easier indentation in visual mode
map("v", "<", "<gv", "Indent left")
map("v", ">", ">gv", "Indent right")

-- format buffer
map("n", "<leader>fb", ":lua vim.lsp.buf.format()<CR>", "Format buffer")

-- move lines
map("n", "<A-j>", ":m .+1<CR>==")
map("n", "<A-k>", ":m .-2<CR>==")
map("i", "<A-j>", "<Esc>:m .+1<CR>==gi")
map("i", "<A-k>", "<Esc>:m .-2<CR>==gi")
map("v", "<A-j>", ":m '>+1<CR>gv=gv")
map("v", "<A-k>", ":m '<-2<CR>gv=gv")

-- delete backwards to start of previous line
map("n", "<leader>db", "d?$<cr>", "Delete backwards to start of previous line")

-- navigate to the next issue in the current file
map("n", "<leader>in", function()
	vim.diagnostic.jump({
		count = 1,
		severity_limit = vim.diagnostic.severity.WARN,
	})
	vim.cmd("normal! zz")
end, "Navigate to the next issue in the current buffer")

-- navigate to the previous issue in the current file
map("n", "<leader>ip", function()
	vim.diagnostic.jump({
		count = -1,
		severity_limit = vim.diagnostic.severity.WARN,
	})
	vim.cmd("normal! zz")
end, "Navigate to the previous issue in the current buffer")

-- auto switch to newly created splits
map(
	"n",
	"<C-W>v",
	(
		vim.g.vscode and ":lua require('vscode').call('workbench.action.splitEditor')<CR>"
		or ":vsplit<CR> <bar> :wincmd l<CR>"
	),
	"Create a new vertical split and switch to it"
)
map(
	"n",
	"<C-W>s",
	(
		vim.g.vscode and ":lua require('vscode').call('workbench.action.splitEditorDown')<CR>"
		or ":split<CR> <bar> :wincmd j<CR>"
	),
	"Create a new horizontal split and switch to it"
)

-- Search for the word under the cursor and jump to the next match.
map("n", "<leader>fn", function()
	local word = vim.fn.expand("<cword>")
	vim.fn.setreg("/", "\\<" .. word .. "\\>")
	vim.cmd("normal! l") -- move cursor right to avoid matching the current word
	vim.cmd("normal! n") -- jump to the next occurrence
	vim.cmd("normal! zz") -- center the screen on the current line
end, "Find next occurrence of word under cursor")

-- remap split manipulation to SHIFT + CTRL + hjkl
map("n", "<C-S-h>", ":wincmd H<CR>")
map("n", "<C-S-j>", ":wincmd J<CR>")
map("n", "<C-S-k>", ":wincmd K<CR>")
map("n", "<C-S-l>", ":wincmd L<CR>")

-- buffer controls
map("n", "<leader>z", ":bp <bar> :bd #<CR>", "Close buffer but keep split") -- close buffer but keep split
map("n", "<leader>0", ":b#<CR>", "Go to previoulsy active buffer") --  previously active buffer

-- remap split navigation to CTRL + hjkl
map(
	"n",
	"<S-h>",
	(vim.g.vscode and ":lua require('vscode').call('workbench.action.focusPreviousGroup')<CR>" or ":wincmd h<CR>")
)
map(
	"n",
	"<S-j>",
	(vim.g.vscode and ":lua require('vscode').call('workbench.action.focusNextGroup')<CR>" or ":wincmd j<CR>")
)
map(
	"n",
	"<S-k>",
	(vim.g.vscode and ":lua require('vscode').call('workbench.action.focusPreviousGroup')<CR>" or ":wincmd k<CR>")
)
map(
	"n",
	"<S-l>",
	(vim.g.vscode and ":lua require('vscode').call('workbench.action.focusNextGroup')<CR>" or ":wincmd l<CR>")
)

if vim.g.vscode then
	map("n", "<C-l>", ":lua require('vscode').call('workbench.action.nextEditor')<CR>")
	map("n", "<C-h>", ":lua require('vscode').call('workbench.action.previousEditor')<CR>")
	map(
		"n",
		"<leader>x",
		"<CMD>lua require('vscode').call('workbench.action.closeOtherEditors')<CR><BAR><CMD>lua require('vscode').call('workbench.action.closeEditorsInOtherGroups')<CR><BAR><CMD>lua require('vscode').call('workbench.action.closeSidebar')<CR>"
	)
	map("n", "<leader>e", ":lua require('vscode').call('workbench.action.toggleSidebarVisibility')<CR>")
	map("i", "<Esc>", "<ESC><BAR><CDM>lua require('vscode').call('vscode-neovim.escape')<CR>")
	map("n", "C-p", ":lua require('vscode').call('workbench.action.quickOpen')<CR>")
	map("n", "<leader>lg", ":lua require('vscode').call('workbench.action.findInFiles')<CR>")
end
