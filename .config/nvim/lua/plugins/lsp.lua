return {
	{
		"jmbuhr/otter.nvim",
		event = "LspAttach",
		ft = { "markdown" },
	},
	{
		"antosha417/nvim-lsp-file-operations",
		dependencies = {
			"nvim-lua/plenary.nvim",
			"nvim-tree/nvim-tree.lua",
		},
		event = "LspAttach",
		config = vim.schedule_wrap(function()
			require("lsp-file-operations").setup()
		end),
	},
	{
		"neovim/nvim-lspconfig",
		event = { "BufReadPre", "BufNewFile" },
		dependencies = {
			"lukas-reineke/lsp-format.nvim",
			{
				"jose-elias-alvarez/nvim-lsp-ts-utils",
				ft = { "typescript", "typescriptreact" },
			},
			{
				"MunifTanjim/prettier.nvim",
				ft = {
					"javascript",
					"javascriptreact",
					"typescript",
					"typescriptreact",
					"css",
					"scss",
					"json",
					"html",
					"vue",
				},
			},
			"folke/neodev.nvim",
			"stevearc/conform.nvim",
			"junegunn/fzf",
			"gfanto/fzf-lsp.nvim",
		},
		priority = 50,
		config = function()
			vim.lsp.set_log_level("off")
			local neodev = require("neodev")
			local lspconfig = require("lspconfig")
			local conform = require("conform")

			local capabilities = require("cmp_nvim_lsp").default_capabilities()
			capabilities.textDocument.foldingRange = {
				dynamicRegistration = false,
				lineFoldingOnly = true,
			}
			lspconfig.util.root_pattern(
				".eslintrc",
				".eslintrc.js",
				".eslintrc.cjs",
				".eslintrc.json",
				"package.json",
				"Cargo.toml"
			)

			local group = vim.api.nvim_create_augroup("lsp", {})

			local formatting_augroup = vim.api.nvim_create_augroup("LspFormatting", {})

			require("fzf_lsp").setup()

			vim.lsp.handlers["textDocument/hover"] = vim.lsp.with(vim.lsp.handlers.hover, {
				border = "rounded",
			})

			local on_attach = function(client, bufnr)
				if client.supports_method("textDocument/formatting") then
					vim.api.nvim_clear_autocmds({ group = formatting_augroup, buffer = bufnr })
					vim.api.nvim_create_autocmd("BufWritePre", {
						group = formatting_augroup,
						buffer = bufnr,
						callback = function()
							conform.format({ bufnr = bufnr })
						end,
					})
				end
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
				vim.keymap.set("n", "<leader>rn", vim.lsp.buf.rename, bufopts)
				vim.keymap.set("n", "<leader>ca", vim.lsp.buf.code_action, bufopts)
				-- vim.keymap.set("n", "<leader>f", vim.lsp.buf.formatting, bufopts)

				-- floating diagnostics
				local signs = { Error = " ", Warn = " ", Hint = " ", Info = " " }
				for type, icon in pairs(signs) do
					local hl = "DiagnosticSign" .. type
					vim.fn.sign_define(hl, { text = icon, texthl = hl, numhl = hl })
				end

				vim.diagnostic.config({
					virtual_text = false,
					signs = true,
					underline = true,
					update_in_insert = true,
					severity_sort = true,
				})

				vim.api.nvim_create_autocmd("CursorHold", {
					buffer = bufnr,
					group = group,
					callback = function()
						local opts = {
							focusable = false,
							close_events = { "BufLeave", "CursorMoved", "InsertEnter", "FocusLost" },
							border = "rounded",
							source = "always",
							prefix = "  ",
							scope = "cursor",
							max_width = 100,
						}
						vim.diagnostic.open_float(nil, opts)
					end,
				})

				conform.setup({
					format_on_save = {
						lsp_fallback = true,
						bufnr = bufnr,
						quiet = true,
					},
					formatters_by_ft = {
						fish = { { "fish_indent" } },
						lua = { { "stylua" } },
						markdown = { { "prettierd" } },
						mdx = { { "prettierd" } },
						html = { { "prettierd" } },
						javascript = { { "prettierd" } },
						javascriptreact = { { "prettierd" } },
						["javascript.jsx"] = { { "prettierd" } },
						typescript = { { "prettierd" } },
						typescriptreact = { { "prettierd" } },
						["typescript.tsx"] = { { "prettierd" } },
						rust = { { "cargo fmt -- --force" } },
					},
				})
			end

			local language_servers = require("lspconfig").util.available_servers() -- or list servers manually like {'gopls', 'clangd'}
			for _, ls in ipairs(language_servers) do
				require("lspconfig")[ls].setup({
					capabilities = capabilities,
					on_attach = on_attach,
				})
			end

			lspconfig.tailwindcss.setup({
				cmd = { "tailwindcss-language-server", "--stdio" },
				capabilities = capabilities,
				on_attach,
			})

			neodev.setup({
				capabilities = capabilities,
				on_attach,
				library = {
					plugins = {
						{ "nvim-dap-ui", types = true },
					},
				},
			})

			lspconfig.html.setup({
				capabilities = capabilities,
				on_attach = on_attach,
			})

			lspconfig.rust_analyzer.setup({
				capabilities = capabilities,
				on_attach = on_attach,
			})

			lspconfig.tsserver.setup({
				init_options = require("nvim-lsp-ts-utils").init_options,
				capabilities = capabilities,
				on_attach = function(client, bufnr)
					local ts_utils = require("nvim-lsp-ts-utils")

					ts_utils.setup({
						enable_import_on_completion = true,
						auto_inlay_hints = false,
					})

					ts_utils.setup_client(client)

					local opts = { silent = true }
					vim.api.nvim_buf_set_keymap(bufnr, "n", "gs", "<cmd>TSLspOrganize<cr>", opts)
					vim.api.nvim_buf_set_keymap(bufnr, "n", "gr", "<cmd>TSLspRenameFile<cr>", opts)
					vim.api.nvim_buf_set_keymap(bufnr, "n", "gi", "<cmd>TSLspImportAll<cr>", opts)

					on_attach(client, bufnr)
				end,
			})

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

			lspconfig.eslint.setup({
				on_attach = function(client, bufnr)
					on_attach(client, bufnr)
					vim.api.nvim_create_autocmd("BufWritePre", {
						buffer = bufnr,
						command = "EslintFixAll",
					})
				end,
				capabilities = capabilities,
			})
		end,
	},
}
