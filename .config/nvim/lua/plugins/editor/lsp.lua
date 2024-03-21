local setup_diagnostics = function(bufnr)
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

local setup_formatters = function(client, bufnr)
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

	local web_formatters = { { "prettierd", "prettier" } }
	conform.setup({
		format_on_save = {
			timeout = 2000, -- 2s (prettier is slow sometimes)
			lsp_fallback = true,
			bufnr = bufnr,
			quiet = true,
		},
		formatters_by_ft = {
			html = web_formatters,
			javascript = web_formatters,
			javascriptreact = web_formatters,
			["javascript.jsx"] = web_formatters,
			typescript = web_formatters,
			typescriptreact = web_formatters,
			["typescript.tsx"] = web_formatters,
			fish = { { "fish_indent" } },
			lua = { { "stylua" } },
			markdown = { { "prettierd", "prettier" } },
			mdx = { { "biome format" } },
			json = { { "biome format" } },
			rust = { { "cargo fmt -- --force" } },
			yaml = { { "prettierd", "prettier" } },
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

local setup_keymaps = function(client, bufnr)
	function nmap(keys, cmd, desc)
		if desc then
			desc = "LSP: " .. desc
		end
		vim.keymap.set("n", keys, cmd, { buffer = bufnr, desc = desc })
	end

	nmap("gD", vim.lsp.buf.declaration, "[G]o to [D]eclaration")
	nmap("gi", vim.lsp.buf.implementation, "[G]o to [I]mplementation")
	nmap("gr", vim.lsp.buf.references, "[G]o to [R]eferences")
	nmap("<C-k>", vim.lsp.buf.signature_help, "Signature Help")
	nmap("<leader>k", vim.lsp.buf.hover, "Hover")
	nmap("gtd", vim.lsp.buf.type_definition, "[G]o to [T]ype [D]efinition")
	nmap("<leader>rn", vim.lsp.buf.rename, "[R]e[n]ame")
	nmap("<leader>ca", vim.lsp.buf.code_action, "[C]ode [A]ction")

	if client.name == "typescript-tools" then
		nmap("<leader>fr", ":TSToolsRenameFile<cr>", "[R]ename [F]ile")
		nmap("<leader>ru", ":TSToolsRemoveUnused<cr>", "[R]emove [U]nused")
		nmap("<leader>rui", ":TSToolsRemoveUnusedImports<cr>", "[R]emove [U]nused [I]mports")
		nmap("<leader>ia", ":TSToolsAddMissingImports<cr>", "[I]mport [A]ll")
		nmap("gd", ":TSToolsGoToSourceDefinition<cr>", "[G]o to [D]efinition")
		return
	end

	if client.name == "tsserver" then
		nmap("<leader>rf", ":TSLspRenameFile<cr>", "[R]ename [F]ile")
	end

	nmap("gd", vim.lsp.buf.definition, "[G]o to [D]efinition")
end

local on_attach = function(client, bufnr)
	setup_keymaps(client, bufnr)
	setup_diagnostics(bufnr)
	setup_formatters(client, bufnr)
end

return {
	{
		"neovim/nvim-lspconfig",
		event = { "BufReadPost", "BufNewFile" },
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
			"stevearc/conform.nvim",
			{ "folke/neodev.nvim", ft = { "lua" }, opts = {} },
			{
				"pmizio/typescript-tools.nvim",
				ft = { "typescript", "typescriptreact" },
			},
			{
				"jose-elias-alvarez/nvim-lsp-ts-utils",
				ft = { "typescript", "typescriptreact" },
			},
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
		init = function()
			local hover_config = {
				title = "",
				border = "rounded",
				max_width = 100,
				focusable = false,
			}
			vim.lsp.set_log_level("off")
			vim.lsp.handlers["textDocument/hover"] = vim.lsp.with(vim.lsp.handlers.hover, hover_config)
			vim.lsp.handlers["textDocument/signatureHelp"] = vim.lsp.with(vim.lsp.handlers.signature_help, hover_config)
			vim.diagnostic.config({
				virtual_text = false,
				signs = true,
				underline = true,
				update_in_insert = true,
				severity_sort = true,
			})
		end,
		config = function()
			require("inc_rename").setup({
				input_buffer_type = "dressing",
			})

			local capabilities = vim.lsp.protocol.make_client_capabilities()
			capabilities = vim.tbl_deep_extend("force", capabilities, require("cmp_nvim_lsp").default_capabilities())
			capabilities.textDocument.foldingRange = {
				dynamicRegistration = false,
				lineFoldingOnly = true,
			}

			local servers = {
				rust_analyzer = {},
				html = {},
				marksman = {},
				dockerls = {},
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
				tsserver = {
					init_options = require("nvim-lsp-ts-utils").init_options,
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
				"stylua",
				"biome",
				"tsserver",
				"prettier",
				"prettierd",
			})

			require("mason-tool-installer").setup({ ensure_installed = ensure_installed })
			require("mason").setup()

			local use_ts_tools = true
			require("mason-lspconfig").setup({
				handlers = {
					function(server_name)
						if use_ts_tools and server_name == "tsserver" then
							-- typescript
							require("typescript-tools").setup({
								capabilities = capabilities,
								on_attach = on_attach,
								settings = {},
							})
							return
						end
						local server = servers[server_name] or {}
						require("lspconfig")[server_name].setup({
							capabilities = vim.tbl_deep_extend("force", {}, capabilities, server.capabilities or {}),
							on_attach = on_attach,
							settings = server.settings,
							cmd = server.cmd,
						})
					end,
				},
			})
			local lspconfig = require("lspconfig")
			lspconfig.util.root_pattern(
				".eslintrc",
				".eslintrc.js",
				".eslintrc.cjs",
				".eslintrc.json",
				"package.json",
				"Cargo.toml"
			)

			-- neovim
			require("neodev").setup({ capabilities = capabilities, on_attach })
		end,
	},
}
