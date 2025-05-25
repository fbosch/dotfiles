local M = {}
local utils = require("utils")
local yank = require("utils.yank")
local vscode = require("utils.vscode")
local refactor = require("utils.refactor")
local kagi = require("utils.kagi")
local web = require("utils.web")

local map = utils.set_keymap

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

-- kagi
map("n", "<leader>ka", kagi.prompt_fastgpt, "Prompt Kagi FastGPT")
map("n", "<leader>kp", kagi.show_previous_response, "Show previous Kagi response")
map("n", "<leader>ks", kagi.summarize_nearest_url, "Summarize URL under cursor with Kagi")
map("n", "<leader>ko", kagi.search_query, "Search query in browser with Kagi")

-- web
map("n", "<leader>oa", web.open_uris_in_buffer, "Open all URIs in current buffer")
map("x", "<leader>oa", web.open_uris_in_selection, "Open all URIs in selection")

-- compare selection with clipboard
map("v", "<leader>dc", "<CMD>DiffClip<CR>", "Compare selection with clipboard")

-- clear search highlights
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

-- don't yank on put
map("x", "p", '"_dP')

-- special yanking utilities
map("n", "<leader>yf", ":%y<cr>", "Yank current buffer")
map("n", "<leader>yd", yank.cursor_diagnostics, "Yank diagnostic message under cursor")
map("n", "<leader>yad", yank.all_diagnostics, "Yank all diagnostics in buffer")
map("x", "<leader>ym", yank.selection_to_markdown, "Yank visual selection as markdown code block")
map("n", "<leader>yfm", yank.file_to_markdown, "Yank current buffer as markdown code block")

-- search for the word under the cursor and jump to the next match.
map("n", "<leader>fn", function()
	local word = vim.fn.expand("<cword>")
	vim.fn.setreg("/", "\\<" .. word .. "\\>")
	vim.cmd("normal! l")
	vim.cmd("normal! n")
	vim.cmd("normal! zz")
end, "Find next occurrence of word under cursor")

-- find and replace
map("n", "<leader>r", ":%s/<C-R><C-W>//gI<left><left><left>", "Replace words under cursor in buffer") -- in buffer
map("n", "<leader>R", refactor.find_and_replace_word, "Replace word under cursor in project")
map("x", "<leader>R", refactor.find_and_replace_selection, "Replace text selection in project")

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

-- remap split manipulation to SHIFT + CTRL + hjkl
map("n", "<C-S-h>", ":wincmd H<CR>")
map("n", "<C-S-j>", ":wincmd J<CR>")
map("n", "<C-S-k>", ":wincmd K<CR>")
map("n", "<C-S-l>", ":wincmd L<CR>")

-- buffer controls
map("n", "<leader>bd", ":bp <bar> :bd #<CR>", "Close buffer but keep split") -- close buffer but keep split
map("n", "<leader>0", ":b#<CR>", "Go to previoulsy active buffer") --  previously active buffer

-- auto switch to newly created splits
vscode.adaptive_map("n", "<C-W>v", "workbench.action.splitEditor", ":vsplit<CR> <bar> :wincmd l<CR>")
vscode.adaptive_map("n", "<C-W>s", "workbench.action.splitEditorDown", ":split<CR> <bar> :wincmd j<CR>")

-- split navigation (Shift+h/j/k/l)
vscode.adaptive_map("n", "<S-h>", "workbench.action.focusPreviousGroup", ":wincmd h<CR>")
vscode.adaptive_map("n", "<S-j>", "workbench.action.focusNextGroup", ":wincmd j<CR>")
vscode.adaptive_map("n", "<S-k>", "workbench.action.focusPreviousGroup", ":wincmd k<CR>")
vscode.adaptive_map("n", "<S-l>", "workbench.action.focusNextGroup", ":wincmd l<CR>")

-- vscode exclusive keybindings
if vim.g.vscode then
	map("n", "<C-l>", vscode.call("workbench.action.nextEditor"))
	map("n", "<C-h>", vscode.call("workbench.action.previousEditor"))

	map(
		"n",
		"<leader>x",
		-- replicates :BufferCloseAllButVisible
		table.concat({
			vscode.call("workbench.action.closeOtherEditors"),
			vscode.call("workbench.action.closeEditorsInOtherGroups"),
			vscode.call("workbench.action.closeSidebar"),
		}, "<BAR>")
	)

	map("n", "<leader>e", vscode.call("workbench.action.toggleSidebarVisibility"))
	map("i", "<Esc>", "<ESC><BAR>" .. vscode.call("vscode-neovim.escape"))
	map("n", "<C-p>", vscode.call("workbench.action.quickOpen"))
	map("n", "<leader>lg", vscode.call("workbench.action.findInFiles"))
end

function M.setup_lsp_keymaps(client, bufnr)
	function nmap(keys, cmd, desc)
		if desc then
			desc = "LSP: " .. desc
		end
		map("n", keys, cmd, { buffer = bufnr, desc = desc })
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
	nmap("<leader>r", vim.lsp.buf.rename, "[R]e[n]ame")
	nmap("<leader>fi", "<cmd>TSToolsAddMissingImports<CR>", "[F]ix [I]mports")
	nmap("<leader>ca", vim.lsp.buf.code_action, "[C]ode [A]ction")
	nmap("<leader>lsp", "<cmd>:LspRestart<CR>", "restart langauge server")
end

return M
