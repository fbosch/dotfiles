return {
	"neovim/nvim-lspconfig",
	event = { "BufReadPre", "BufNewFile" },
	dependencies = {
		"williamboman/mason.nvim",
		"lukas-reineke/lsp-format.nvim",
		"jose-elias-alvarez/nvim-lsp-ts-utils",
		"junegunn/fzf",
		"folke/lsp-colors.nvim",
		"gfanto/fzf-lsp.nvim",
		"MunifTanjim/prettier.nvim",
		"MunifTanjim/eslint.nvim",
		"jose-elias-alvarez/null-ls.nvim",
		"folke/neodev.nvim",
		"stevearc/conform.nvim",
	},
	config = function()
		local neodev = require("neodev")
		local lspconfig = require("lspconfig")
		local prettier = require("prettier")
		local conform = require("conform")

		prettier.setup({
			bin = "prettierd",
			filetypes = {
				"css",
				"graphql",
				"html",
				"javascript",
				"javascriptreact",
				"json",
				"less",
				"markdown",
				"scss",
				"typescript",
				"typescriptreact",
				"yaml",
			},
		})

		local group = vim.api.nvim_create_augroup("lsp", {})
		local capabilities = require("cmp_nvim_lsp").default_capabilities()
		lspconfig.util.root_pattern(
			".eslintrc",
			".eslintrc.js",
			".eslintrc.json",
			"package.json",
			"pnpm-lock.yaml",
			"yarn.lock",
			".git"
		)
		capabilities.textDocument.foldingRange = {
			dynamicRegistration = false,
			lineFoldingOnly = true,
		}

		local augroup = vim.api.nvim_create_augroup("LspFormatting", {})

		conform.setup({
			format_on_save = {
				lsp_fallback = true,
			},
			formatters_by_ft = {
				lua = { "stylua" },
				javascript = { { "prettierd", "prettier" } },
				javascriptreact = { { "prettierd", "prettier" } },
				["javascript.jsx"] = { { "prettierd", "prettier" } },
				typescript = { { "prettierd", "prettier" } },
				typescriptreact = { { "prettierd", "prettier" } },
				["typescript.tsx"] = { { "prettierd", "prettier" } },
			},
		})

		require("fzf_lsp").setup()
		require("mason").setup({
			ui = {
				border = "rounded",
				icons = {
					package_installed = "",
					package_pending = "",
					package_uninstalled = "",
				},
			},
		})

		vim.lsp.handlers["textDocument/hover"] = vim.lsp.with(vim.lsp.handlers.hover, {
			border = "rounded",
		})

		local on_attach = function(client, bufnr)
			vim.api.nvim_buf_set_option(bufnr, "omnifunc", "v:lua.vim.lsp.omnifunc")
			if client.supports_method("textDocument/formatting") then
				vim.api.nvim_clear_autocmds({ group = augroup, buffer = bufnr })
				vim.api.nvim_create_autocmd("BufWritePre", {
					group = augroup,
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
			local signs = { Error = " ", Warn = " ", Hint = " ", Info = " " }
			for type, icon in pairs(signs) do
				local hl = "DiagnosticSign" .. type
				vim.fn.sign_define(hl, { text = icon, texthl = hl, numhl = hl })
			end

			vim.diagnostic.config({
				virtual_text = false,
				signs = true,
				underline = true,
				update_in_insert = true,
				severity_sort = false,
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
					}
					vim.diagnostic.open_float(nil, opts)
				end,
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
			on_attach = on_attach,
			capabilities = capabilities,
		})

		lspconfig.tsserver.setup({
			init_options = require("nvim-lsp-ts-utils").init_options,
			capabilities = capabilities,
			on_attach = function(client, bufnr)
				if client.config.flags then
					client.config.flags.allow_incremental_sync = true
				end
				client.resolved_capabilities.document_formatting = false

				local ts_utils = require("nvim-lsp-ts-utils")

				ts_utils.setup({
					enable_import_on_completion = true,
					auto_inlay_hints = false,
				})

				ts_utils.setup_client(client)

				local opts = { silent = true }
				vim.api.nvim_buf_set_keymap(bufnr, "n", "gs", ":TSLspOrganize<CR>", opts)
				vim.api.nvim_buf_set_keymap(bufnr, "n", "gr", ":TSLspRenameFile<CR>", opts)
				vim.api.nvim_buf_set_keymap(bufnr, "n", "gi", ":TSLspImportAll<CR>", opts)

				on_attach(client, bufnr)
			end,
		})

		lspconfig.lua_ls.setup({
			capabilities = capabilities,
			settings = {
				Lua = {
					completion = {
						callSnippet = "Replace",
					},
				},
			},
		})

		local eslint = {
			lintCommand = "eslint_d -f unix --stdin --stdin-filename ${INPUT}",
			lintStdin = true,
			lintFormats = { "%f:%l:%c: %m" },
			lintIgnoreExitCode = true,
			formatCommand = "eslint_d --fix-to-stdout --stdin --stdin-filename=${INPUT}",
			formatStdin = true,
		}

		lspconfig.efm.setup({
			capabilities = capabilities,
			on_attach = function(client, bufnr)
				on_attach(client, bufnr)
				client.resolved_capabilities.document_formatting = true
				client.resolved_capabilities.goto_definition = false
			end,
			settings = {
				languages = {
					javascript = { eslint },
					javascriptreact = { eslint },
					["javascript.jsx"] = { eslint },
					typescript = { eslint },
					["typescript.tsx"] = { eslint },
					typescriptreact = { eslint },
				},
			},
			filetypes = {
				"javascript",
				"javascriptreact",
				"javascript.jsx",
				"typescript",
				"typescript.tsx",
				"typescriptreact",
			},
		})
	end,
}
