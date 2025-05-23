local M = {}
local base_opts = { noremap = true, silent = true }

local function map(mode, lhs, rhs, opts_or_desc)
	local opts = vim.tbl_extend(
		"force",
		base_opts,
		type(opts_or_desc) == "string" and { desc = opts_or_desc } or (opts_or_desc or {})
	)
	vim.keymap.set(mode, lhs, rhs, opts)
end

local function vscode_adaptive_map(mode, lhs, vscode_cmd, nvim_cmd)
	map(mode, lhs, vim.g.vscode and (":lua require('vscode').call('" .. vscode_cmd .. "')<CR>") or nvim_cmd)
end

-- disable key that is used as leader
map("n", "<Space>", "<NOP>")

-- Swap ; and :
map("n", ":", ";")
map("n", ";", ":")
map("x", ":", ";")
map("x", ";", ":")

-- remap nordic key layout in normal mode, to minimize how often I have to toggle between keyboard layouts
map("n", "æ", ":")
map("n", "ø", "'")
map("n", "å", "[")
map("n", "¨", "]")
map("x", "æ", ":")
map("x", "ø", "'")
map("x", "å", "[")
map("x", "¨", "]")
map("n", "-", "/")

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
		severity_limit = vim.diagnostic.severity.ERROR,
	})
	vim.cmd("normal! zz")
end, "Navigate to the next issue in the current buffer")

-- navigate to the previous issue in the current file
map("n", "<leader>ip", function()
	vim.diagnostic.jump({
		count = -1,
		severity_limit = vim.diagnostic.severity.ERROR,
	})
	vim.cmd("normal! zz")
end, "Navigate to the previous issue in the current buffer")

-- yoink diagnostic message under cursor
map("n", "<leader>yd", function()
	local pos = vim.api.nvim_win_get_cursor(0)
	local diagnostics = vim.diagnostic.get(0, { lnum = pos[1] - 1 })
	if #diagnostics > 0 then
		local message = diagnostics[1].message
		vim.fn.setreg("+", message) -- System clipboard
		vim.notify("Diagnostics copied to clipboard", vim.log.levels.INFO, { title = "Diagnostics" })
	else
		vim.notify("No diagnostic under cursor.", vim.log.levels.WARN, { title = "Diagnostics" })
	end
end, "Yank diagnostic message under cursor")

map("n", "<leader>yad", function()
	local diagnostics = vim.diagnostic.get(0)
	if #diagnostics == 0 then
		vim.notify("No diagnostics in buffer.", vim.log.levels.WARN, { title = "Diagnostics" })
		return
	end

	local messages = {}
	for _, diag in ipairs(diagnostics) do
		table.insert(messages, string.format("[%s:%d] %s", diag.source or "LSP", diag.lnum + 1, diag.message))
	end

	local result = table.concat(messages, "\n")
	vim.fn.setreg("+", result) -- System clipboard

	vim.notify("All diagnostics copied to clipboard", vim.log.levels.INFO, { title = "Diagnostics" })
end, "Yank all diagnostics in buffer")

map("n", "<leader>qf", function()
	if vim.fn.getqflist({ winid = 0 }).winid ~= 0 then
		vim.cmd("cclose")
	else
		vim.cmd("copen")
	end
end, "Toggle Quickfix List")

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
map("n", "<leader>bd", ":bp <bar> :bd #<CR>", "Close buffer but keep split") -- close buffer but keep split
map("n", "<leader>0", ":b#<CR>", "Go to previoulsy active buffer") --  previously active buffer

-- Split navigation (Shift+h/j/k/l)
vscode_adaptive_map("n", "<S-h>", "workbench.action.focusPreviousGroup", ":wincmd h<CR>")
vscode_adaptive_map("n", "<S-j>", "workbench.action.focusNextGroup", ":wincmd j<CR>")
vscode_adaptive_map("n", "<S-k>", "workbench.action.focusPreviousGroup", ":wincmd k<CR>")
vscode_adaptive_map("n", "<S-l>", "workbench.action.focusNextGroup", ":wincmd l<CR>")

-- vscode exclusive keybindings
if vim.g.vscode then
	local call = function(cmd)
		return ":lua require('vscode').call('" .. cmd .. "')<CR>"
	end

	map("n", "<C-l>", call("workbench.action.nextEditor"))
	map("n", "<C-h>", call("workbench.action.previousEditor"))

	map(
		"n",
		"<leader>x",
		table.concat({
			call("workbench.action.closeOtherEditors"),
			call("workbench.action.closeEditorsInOtherGroups"),
			call("workbench.action.closeSidebar"),
		}, "<BAR>")
	)

	map("n", "<leader>e", call("workbench.action.toggleSidebarVisibility"))
	map("i", "<Esc>", "<ESC><BAR>:lua require('vscode').call('vscode-neovim.escape')<CR>")
	map("n", "<C-p>", call("workbench.action.quickOpen"))
	map("n", "<leader>lg", call("workbench.action.findInFiles"))
end

function M.setup_lsp_keymap(client, bufnr)
	function nmap(keys, cmd, desc)
		if desc then
			desc = "LSP: " .. desc
		end
		vim.keymap.set("n", keys, cmd, { buffer = bufnr, desc = desc })
	end

	nmap("gD", vim.lsp.buf.declaration, "[G]o to [D]eclaration")
	nmap("gd", vim.lsp.buf.definition, "[G]o to [D]efinition")
	nmap("<leader>gd", function()
		vim.cmd("vsplit")
		vim.lsp.buf.definition()
	end, "[G]o to [D]efinition in split")
	nmap("<leader>pd", "<cmd>Lspsaga peek_definition<CR>", "[P]eek [D]efinition")
	nmap("gi", vim.lsp.buf.implementation, "[G]o to [I]mplementation")
	nmap("gr", vim.lsp.buf.references, "[G]o to [R]eferences")
	nmap("<leader>k", "<cmd>Lspsaga hover_doc<CR>", "Hover")
	nmap("gtd", vim.lsp.buf.type_definition, "[G]o to [T]ype [D]efinition")
	nmap("<leader>rn", vim.lsp.buf.rename, "[R]e[n]ame")
	nmap("<leader>fi", "<cmd>TSToolsAddMissingImports<CR>", "[F]ix [I]mports")
	nmap("<leader>ca", vim.lsp.buf.code_action, "[C]ode [A]ction")
	nmap("<leader>lsp", "<cmd>:LspRestart<CR>", "restart langauge server")
end

return M
