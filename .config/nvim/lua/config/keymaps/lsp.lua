local M = {}

function M.setup(client, bufnr)
	local function nmap(keys, cmd, desc)
		local opts = { buffer = bufnr, silent = true, noremap = true }
		if desc then
			opts.desc = "LSP: " .. desc
		end
		-- Clear any existing keymap first
		pcall(vim.keymap.del, "n", keys, { buffer = bufnr })
		-- Set the keymap
		vim.keymap.set("n", keys, cmd, opts)
	end

	nmap("gD", vim.lsp.buf.declaration, "[G]o to [D]eclaration")
	nmap("gd", vim.lsp.buf.definition, "[G]o to [D]efinition")
	nmap("<leader>gd", function()
		vim.cmd("vsplit")
		vim.lsp.buf.definition()
	end, "[G]o to [D]efinition in split")
	nmap("<leader>pd", function()
		vim.cmd("Lspsaga peek_definition")
	end, "[P]eek [D]efinition")
	nmap("<leader>k", function()
		-- Try lspsaga command first
		local cmd_ok = pcall(vim.cmd, "Lspsaga hover_doc")
		if not cmd_ok then
			-- Fall back to built-in LSP hover
			vim.lsp.buf.hover()
		end
	end, "Hover")
	nmap("gi", vim.lsp.buf.implementation, "[G]o to [I]mplementation")
	nmap("gr", vim.lsp.buf.references, "[G]o to [R]eferences")
	nmap("gtd", vim.lsp.buf.type_definition, "[G]o to [T]ype [D]efinition")
	nmap("<leader>rn", vim.lsp.buf.rename, "[R]e[n]ame")
	nmap("<leader>fi", "<cmd>TSToolsAddMissingImports<CR>", "[F]ix [I]mports")
	nmap("<leader>ca", vim.lsp.buf.code_action, "[C]ode [A]ction")
	nmap("<leader>lsp", "<cmd>:LspRestart<CR>", "restart langauge server")
end

return M
