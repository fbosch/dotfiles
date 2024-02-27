local function setup_diagnostics(bufnr)
	local group = vim.api.nvim_create_augroup("LspDiagnostic", {})
	local signs = { Error = " ", Warn = " ", Hint = " ", Info = " " }
	for type, icon in pairs(signs) do
		local hl = "DiagnosticSign" .. type
		vim.fn.sign_define(hl, { text = icon, texthl = hl, numhl = hl })
	end

	local diag_opts = {
		header = "",
		focusable = false,
		close_events = { "BufLeave", "CursorMoved", "InsertEnter", "FocusLost" },
		border = "rounded",
		source = "always",
		prefix = "  ",
		scope = "line",
		max_width = 100,
	}

	vim.api.nvim_create_autocmd({ "CursorMoved" }, {
		buffer = bufnr,
		group = group,
		callback = function()
			vim.diagnostic.open_float(bufnr, diag_opts)
		end,
	})
end

local function setup_formatters(client, bufnr)
	local conform = require("conform")
	local group = vim.api.nvim_create_augroup("LspFormatting", {})

	if client.name == "tsserver" or client.name == "typescript-tools" then
		local ts_utils = require("nvim-lsp-ts-utils")
		ts_utils.setup({
			enable_import_on_completion = true,
			auto_inlay_hints = true,
		})
		ts_utils.setup_client(client)
	end

	if client.name == "eslint" then
		vim.api.nvim_create_autocmd("BufWritePre", {
			buffer = bufnr,
			command = "EslintFixAll",
			group = group,
		})
	end

	conform.setup({
		format_on_save = {
			lsp_fallback = true,
			bufnr = bufnr,
			quiet = true,
		},
		formatters_by_ft = {
			fish = { { "fish_indent" } },
			lua = { { "stylua" } },
			markdown = { { "biome format" } },
			mdx = { { "biome format" } },
			html = { { "prettierd" } },
			json = { { "biome format" } },
			javascript = { { "prettierd" } },
			javascriptreact = { { "prettierd" } },
			["javascript.jsx"] = { { "prettierd" } },
			typescript = { { "prettierd" } },
			typescriptreact = { { "prettierd" } },
			["typescript.tsx"] = { { "prettierd" } },
			rust = { { "cargo fmt -- --force" } },
		},
	})

	if client.supports_method("textDocument/formatting") then
		vim.api.nvim_clear_autocmds({ group = group, buffer = bufnr })
		vim.api.nvim_create_autocmd("BufWritePre", {
			group = group,
			buffer = bufnr,
			callback = function()
				conform.format({ bufnr = bufnr })
			end,
		})
	end
end

local function setup_keymaps(bufnr)
	local bufopts = { noremap = true, silent = true, buffer = bufnr }
	vim.keymap.set("n", "gD", vim.lsp.buf.declaration, bufopts)
	vim.keymap.set("n", "gd", vim.lsp.buf.definition, bufopts)
	vim.keymap.set("n", "gi", vim.lsp.buf.implementation, bufopts)
	vim.keymap.set("n", "gr", vim.lsp.buf.references, bufopts)
	vim.keymap.set("n", "<C-k>", vim.lsp.buf.signature_help, bufopts)
	vim.keymap.set("n", "<leader>k", require("pretty_hover").hover, bufopts)
	vim.keymap.set("n", "<leader>wa", vim.lsp.buf.add_workspace_folder, bufopts)
	vim.keymap.set("n", "<leader>wr", vim.lsp.buf.remove_workspace_folder, bufopts)
	vim.keymap.set("n", "<leader>wl", function()
		print(vim.inspect(vim.lsp.buf.list_workspace_folders()))
	end, bufopts)
	vim.keymap.set("n", "<leader>D", vim.lsp.buf.type_definition, bufopts)
	-- vim.keymap.set("n", "<leader>rn", vim.lsp.buf.rename, bufopts)
	vim.keymap.set("n", "<leader>rn", ":IncRename ", bufopts)
	vim.keymap.set("n", "<leader>ca", vim.lsp.buf.code_action, bufopts)
end

local on_attach = function(client, bufnr)
	setup_keymaps(bufnr)
	setup_diagnostics(bufnr)
	setup_formatters(client, bufnr)
end

return {
	{
		"neovim/nvim-lspconfig",
		event = { "BufReadPre", "BufNewFile" },
		dependencies = {
			"stevearc/conform.nvim",
			{
				"williamboman/mason.nvim",
				opts = {
					ui = {
						border = "rounded",
						icons = {
							package_installed = "",
							package_pending = "",
							package_uninstalled = "",
						},
					},
				},
			},
			{ "smjonas/inc-rename.nvim" },
			{ "folke/neodev.nvim", ft = { "lua" } },
			{
				"pmizio/typescript-tools.nvim",
				ft = { "typescript", "typescriptreact" },
			},
			{
				"jose-elias-alvarez/nvim-lsp-ts-utils",
				ft = { "typescript", "typescriptreact" },
			},
			{
				"Fildo7525/pretty_hover",
				event = { "LspAttach" },
				opts = {
					maxwidth = 80,
				},
			},
		},
		init = function()
			vim.lsp.set_log_level("off")
			vim.lsp.handlers["textDocument/hover"] = vim.lsp.with(vim.lsp.handlers.hover, {
				border = "rounded",
			})
			vim.diagnostic.config({
				virtual_text = false,
				signs = true,
				underline = true,
				update_in_insert = true,
				severity_sort = true,
			})
		end,
		config = function()
			require("inc_rename").setup()
			local lspconfig = require("lspconfig")
			lspconfig.util.root_pattern(
				".eslintrc",
				".eslintrc.js",
				".eslintrc.cjs",
				".eslintrc.json",
				"package.json",
				"Cargo.toml"
			)

			local capabilities = require("cmp_nvim_lsp").default_capabilities()
			capabilities.textDocument.foldingRange = {
				dynamicRegistration = false,
				lineFoldingOnly = true,
			}

			-- rust
			lspconfig.rust_analyzer.setup({
				capabilities = capabilities,
				on_attach = on_attach,
			})

			-- html
			lspconfig.html.setup({ capabilities = capabilities, on_attach })

			-- css
			lspconfig.tailwindcss.setup({
				cmd = { "tailwindcss-language-server", "--stdio" },
				capabilities = capabilities,
				on_attach,
			})
			lspconfig.cssls.setup({
				capabilities = capabilities,
				settings = {
					css = {
						lint = {
							unknownAtRules = "ignore",
						},
					},
				},
				on_attach,
			})

			-- typescript
			local use_ts_tools = false
			if use_ts_tools then
				require("typescript-tools").setup({
					capabilities = capabilities,
					init_options = require("nvim-lsp-ts-utils").init_options,
					on_attach = on_attach,
				})
			else
				lspconfig.tsserver.setup({
					capabilities = capabilities,
					init_options = require("nvim-lsp-ts-utils").init_options,
					on_attach = on_attach,
				})
			end

			-- lua
			require("neodev").setup({ capabilities = capabilities, on_attach })
			lspconfig.lua_ls.setup({
				capabilities = capabilities,
				on_attach = on_attach,
				settings = {
					Lua = {
						diagnostics = {
							globals = { "vim" },
						},
						completion = {
							callSnippet = "Replace",
						},
						format = {
							enable = true,
							formatter = "stylua",
						},
					},
				},
			})
		end,
	},
}
