local setup_diagnostics = function()
	local group = vim.api.nvim_create_augroup("diagnostics", {})
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

	vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI", "TextChanged", "TextChangedI", "BufEnter" }, {
		group = group,
		callback = function()
			vim.diagnostic.open_float(vim.api.nvim_get_current_buf(), diag_opts)
		end,
	})
end

local setup_formatters = function(client, bufnr)
	local group = vim.api.nvim_create_augroup("LspFormatting", {})

	if client.name == "eslint" then
		vim.api.nvim_create_autocmd("BufWritePre", {
			buffer = bufnr,
			command = "EslintFixAll",
			group = group,
		})
	end
end

local setup_keymaps = function(client, bufnr)
	function nmap(keys, cmd, desc)
		if desc then
			desc = "LSP: " .. desc
		end
		vim.keymap.set("n", keys, cmd, { buffer = bufnr, desc = desc })
	end

	nmap("gD", vim.lsp.buf.declaration, "[G]o to [D]eclaration")
	nmap("gd", vim.lsp.buf.definition, "[G]o to [D]efinition")
	nmap("gi", vim.lsp.buf.implementation, "[G]o to [I]mplementation")
	nmap("gr", vim.lsp.buf.references, "[G]o to [R]eferences")
	nmap("<C-k>", vim.lsp.buf.signature_help, "Signature Help")
	nmap("<leader>k", vim.lsp.buf.hover, "Hover")
	nmap("gtd", vim.lsp.buf.type_definition, "[G]o to [T]ype [D]efinition")
	nmap("<leader>rn", vim.lsp.buf.rename, "[R]e[n]ame")
	nmap("<leader>ca", vim.lsp.buf.code_action, "[C]ode [A]ction")

	if client.name == "typescript-tools" then
		nmap("<leader>mi", ":TSToolsAddMissingImports<cr>", "[M]issing [I]mports")
		nmap("<leader>ui", ":TSToolsRemoveUnusedImport<cr>", "Remove [U]nused [I]mports")
	end
end

local on_attach = function(client, bufnr)
	setup_keymaps(client, bufnr)
	setup_diagnostics()
	setup_formatters(client, bufnr)
end

return {
	{
		"stevearc/conform.nvim",
		config = function()
			local group = vim.api.nvim_create_augroup("Conform", {})
			local conform = require("conform")
			local web_formatters = { "prettierd", "prettier", "biome format", stop_after_first = true }
			conform.setup({
				default_format_options = {
					timeout = 1000,
					lsp_format = "fallback",
				},
				format_on_save = {
					quiet = true,
				},
				formatters_by_ft = {
					html = web_formatters,
					css = web_formatters,
					javascript = web_formatters,
					javascriptreact = web_formatters,
					["javascript.jsx"] = web_formatters,
					typescript = web_formatters,
					typescriptreact = web_formatters,
					["typescript.tsx"] = web_formatters,
					fish = { "fish_indent" },
					lua = { "stylua" },
					markdown = { "prettierd", "prettier", stop_after_first = true },
					mdx = { "biome format" },
					json = { "biome format" },
					rust = { "cargo fmt -- --force" },
					yaml = { "prettierd", "prettier", stop_after_first = true },
				},
			})

			vim.api.nvim_create_autocmd("BufWritePre", {
				group = group,
				callback = function()
					conform.format({
						lsp_format = "fallback",
						quiet = true,
					})
				end,
			})
		end,
	},
	{
		"pmizio/typescript-tools.nvim",
		requires = { "nvim-lua/plenary.nvim", "neovim/nvim-lspconfig" },
	},
	{
		"neovim/nvim-lspconfig",
		event = { "BufReadPre", "BufNewFile" },
		dependencies = {
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
			"williamboman/mason-lspconfig.nvim",
			"WhoIsSethDaniel/mason-tool-installer.nvim",
			{ "yioneko/nvim-vtsls", ft = { "typescript", "typescriptreact" } },
			{ "folke/neodev.nvim", ft = { "lua" }, opts = {} },
		},
		keys = {
			{
				"<leader>lsp",
				"<cmd>:LspRestart<cr>",
				desc = "restart langauge server",
				silent = true,
				{ mode = "n" },
			},
		},
		config = function()
			require("inc_rename").setup({
				input_buffer_type = "dressing",
			})

			local lspconfig = require("lspconfig")

			local capabilities = vim.lsp.protocol.make_client_capabilities()
			capabilities = vim.tbl_deep_extend("force", capabilities, require("cmp_nvim_lsp").default_capabilities())
			capabilities.textDocument.foldingRange = {
				dynamicRegistration = false,
				lineFoldingOnly = true,
			}

			local hover_config = {
				title = "",
				border = "rounded",
				max_width = 100,
				focusable = false,
			}
			vim.lsp.handlers["textDocument/hover"] = vim.lsp.with(vim.lsp.handlers.hover, hover_config)
			vim.lsp.handlers["textDocument/signatureHelp"] = vim.lsp.with(vim.lsp.handlers.signature_help, hover_config)
			vim.diagnostic.config({
				virtual_text = false,
				signs = true,
				underline = true,
				update_in_insert = true,
				severity_sort = true,
			})

			local servers = {
				rust_analyzer = {},
				html = {},
				marksman = {},
				dockerls = {},
				vtsls = {},
				docker_compose_language_service = {},
				tailwindcss = {
					cmd = { "tailwindcss-language-server", "--stdio" },
				},
				cssls = {
					settings = {
						css = {
							lint = {
								unknownAtRules = "ignore",
							},
						},
					},
				},
				lua_ls = {
					settings = {
						Lua = {
							runtime = { version = "LuaJIT" },
							diagnostics = {
								globals = { "vim" },
							},
							library = {
								"${3rd}/luv/library",
								unpack(vim.api.nvim_get_runtime_file("", true)),
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
				},
			}

			local ensure_installed = vim.tbl_keys(servers or {})
			vim.list_extend(ensure_installed, {
				-- "vtsls",
				"stylua",
				"biome",
				"tsserver",
				"prettier",
				"prettierd",
			})

			require("mason-tool-installer").setup({ ensure_installed = ensure_installed })
			require("mason").setup()

			require("mason-lspconfig").setup({
				handlers = {
					function(server_name)
						local server = servers[server_name] or {}
						local settings = server.settings or {}

						if server_name == "tsserver" then
							local typescript_tools = require("typescript-tools")
							typescript_tools.setup({
								on_attach = on_attach,
								capabilities = capabilities,
								settings = settings,
								root_dir = lspconfig.util.root_pattern("tsconfig.json"),
							})
							return
						end

						if server_name == "eslint" then
							lspconfig.eslint.setup({
								on_attach = on_attach,
								capabilities = capabilities,
								-- cmd = { "eslint_d", "--stdio" },
								settings = settings,
								root_dir = lspconfig.util.root_pattern(
									".eslintrc.js",
									".eslintrc.json",
									".eslintrc",
									".eslintrc.yml",
									".eslintrc.yaml"
								),
							})
							return
						end

						if server_name == "biome" then
							lspconfig.biome.setup({
								on_attach = on_attach,
								capabilities = capabilities,
								settings = settings,
								cmd = server.cmd,
								root_dir = lspconfig.util.root_pattern("biome.json"),
							})
							return
						end

						lspconfig[server_name].setup({
							capabilities = vim.tbl_deep_extend("force", {}, capabilities, server.capabilities or {}),
							on_attach = on_attach,
							settings = settings,
							cmd = server.cmd,
							root_dir = server.root_dir or lspconfig.util.root_pattern(server.root_files or {}),
						})
					end,
				},
			})

			-- neovim
			require("neodev").setup({ capabilities = capabilities, on_attach })
		end,
	},
}
