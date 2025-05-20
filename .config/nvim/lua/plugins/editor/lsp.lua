local setup_diagnostics = function()
	vim.diagnostic.config({
		signs = {
			text = {
				[vim.diagnostic.severity.ERROR] = " ",
				[vim.diagnostic.severity.WARN] = " ",
				[vim.diagnostic.severity.HINT] = " ",
				[vim.diagnostic.severity.INFO] = " ",
			},
			numhl = {
				[vim.diagnostic.severity.ERROR] = "DiagnosticSignError",
				[vim.diagnostic.severity.WARN] = "DiagnosticSignWarn",
				[vim.diagnostic.severity.HINT] = "DiagnosticSignHint",
				[vim.diagnostic.severity.INFO] = "DiagnosticSignInfo",
			},
			linehl = {},
		},
		virtual_text = false,
		float = {
			show_header = true,
			source = "if_many",
			border = "rounded",
			focusable = false,
			max_width = 100,
			max_height = 10,
			close_events = {
				"BufLeave",
				"CursorMoved",
				"InsertEnter",
				"FocusLost",
			},
		},
		underline = {
			severity = { min = vim.diagnostic.severity.WARN },
		},
		severity_sort = {
			reverse = false,
		},
		update_in_insert = false,
	})

	-- Optional: Create autocmd for showing diagnostics on cursor hold
	local diagnostics_group = vim.api.nvim_create_augroup("DiagnosticsGroup", { clear = true })
	vim.api.nvim_create_autocmd({ "CursorHold", "CursorHoldI" }, {
		group = diagnostics_group,
		callback = function()
			vim.diagnostic.open_float(nil, {
				focusable = false,
				close_events = {
					"BufLeave",
					"CursorMoved",
					"InsertEnter",
					"FocusLost",
				},
				source = "if_many",
				scope = "line",
			})
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
	nmap("<leader>gd", function()
		vim.cmd("vsplit")
		vim.lsp.buf.definition()
	end, "[G]o to [D]efinition in split")
	nmap("<leader>pd", "<cmd>Lspsaga peek_definition<CR>", "[P]eek [D]efinition")
	nmap("gi", vim.lsp.buf.implementation, "[G]o to [I]mplementation")
	nmap("gr", vim.lsp.buf.references, "[G]o to [R]eferences")
	nmap("<leader>k", vim.lsp.buf.signature_help, "Signature Help")
	-- nmap("<leader>k", "<cmd>Lspsaga hover_doc<CR>", "Hover")
	nmap("gtd", vim.lsp.buf.type_definition, "[G]o to [T]ype [D]efinition")
	nmap("<leader>rn", vim.lsp.buf.rename, "[R]e[n]ame")
	nmap("<leader>fi", "<cmd>TSToolsAddMissingImports<CR>", "[F]ix [I]mports")
	nmap("<leader>ca", vim.lsp.buf.code_action, "[C]ode [A]ction")
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
		"neovim/nvim-lspconfig",
		event = { "BufReadPre", "BufNewFile" },
		dependencies = {
			"williamboman/mason-lspconfig.nvim",
			"WhoIsSethDaniel/mason-tool-installer.nvim",
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
			{
				"nvimdev/lspsaga.nvim",
				config = function()
					require("lspsaga").setup({
						lightbulb = {
							enable = false,
						},
						ui = {
							border = "rounded",
							winblend = 20,
						},
						definition = {
							edit = "false",
						},
						symbol_in_winbar = {
							enable = false,
						},
						hover = {
							silent = true,
						},
					})
				end,
			},
			{
				"pmizio/typescript-tools.nvim",
				ft = { "typescript", "typescriptreact", "javascript", "javascriptreact" },
				dependencies = { "nvim-lua/plenary.nvim", "neovim/nvim-lspconfig" },
				enabled = true,
				config = function()
					require("typescript-tools").setup({
						on_attach = on_attach,
						separate_diagnostic_server = false,
						publish_diagnostic_on = "insert_leave",
						complete_function_calls = false,
						jsx_close_tag = {
							enable = false,
							filetypes = { "javascriptreact", "typescriptreact" },
						},
					})
				end,
			},
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
			local lspconfig = require("lspconfig")

			local capabilities = vim.tbl_deep_extend("force", vim.lsp.protocol.make_client_capabilities(), {
				workspace = {
					didChangeWatchedFiles = {
						dynamicRegistration = false,
					},
				},
			})
			capabilities = vim.tbl_deep_extend("force", require("cmp_nvim_lsp").default_capabilities(), capabilities)
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
				ts_ls = {
					enabled = false,
				},
				tsserver = {
					enabled = false,
				},
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

			local ensure_installed = {
				"eslint",
			}
			for name, config in pairs(servers) do
				if config.enabled ~= false then
					table.insert(ensure_installed, name)
				end
			end

			require("mason-tool-installer").setup({ ensure_installed = ensure_installed })
			require("mason").setup()

			require("mason-lspconfig").setup({
				ensure_installed = ensure_installed,
				automatic_installation = false,
				handlers = {
					function(server_name)
						local server = servers[server_name] or {}
						local settings = server.settings or {}
						if server.enabled == false then
							return
						end

						if server_name == "eslint" then
							settings.experimental = {
								useFlatConfig = true,
							}
							lspconfig.eslint.setup({
								on_attach = on_attach,
								capabilities = capabilities,
								settings = settings,
								root_dir = lspconfig.util.root_pattern(
									"eslint.config.js",
									"eslint.config.cjs",
									"eslint.config.mjs",
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
