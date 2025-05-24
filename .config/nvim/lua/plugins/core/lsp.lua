local autocmd = require("config.autocmd")
local keymap = require("config.keymap")
local servers = require("config.servers")

local on_attach = function(client, bufnr)
	autocmd.setup_diagnostics()
	keymap.setup_lsp_keymaps(client, bufnr)
	autocmd.setup_formatters(client, bufnr)
end

local function get_capabilities()
	local capabilities = vim.tbl_deep_extend(
		"force",
		vim.lsp.protocol.make_client_capabilities(),
		require("cmp_nvim_lsp").default_capabilities(),
		{
			workspace = { didChangeWatchedFiles = { dynamicRegistration = false } },
			textDocument = { foldingRange = { dynamicRegistration = false, lineFoldingOnly = true } },
		}
	)
	return capabilities
end

local function setup_lsp_handlers()
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
end

local function get_ensure_installed(servers)
	local ensure = {
		"eslint",
		"html",
		"marksman",
		"rust_analyzer",
		"docker_compose_language_service",
		"tailwindcss",
		"cssls",
		"lua_ls",
	}
	for name, config in pairs(servers) do
		if config.enabled ~= false then
			table.insert(ensure, name)
		end
	end
	return ensure
end

-- Special handling for specific servers
local function mason_handlers(servers, capabilities, on_attach)
	return function(server_name)
		local server = servers[server_name] or {}
		if server.enabled == false then
			return
		end
		local lspconfig = require("lspconfig")
		local settings = server.settings or {}

		if server_name == "eslint" then
			settings.experimental = { useFlatConfig = true }
			lspconfig.eslint.setup({
				on_attach = on_attach,
				capabilities = capabilities,
				settings = settings,
				root_dir = require("lspconfig").util.root_pattern(
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

		-- default lsp setup
		lspconfig[server_name].setup({
			capabilities = vim.tbl_deep_extend("force", {}, capabilities, server.capabilities or {}),
			on_attach = on_attach,
			settings = settings,
			cmd = server.cmd,
			root_dir = server.root_dir or lspconfig.util.root_pattern(server.root_files or {}),
		})
	end
end

return {
	"neovim/nvim-lspconfig",
	event = { "BufReadPre", "BufNewFile" },
	dependencies = {
		"antosha417/nvim-lsp-file-operations",
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
			event = "VeryLazy",
			opts = {
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
			},
		},
		{ "folke/lazydev.nvim", ft = { "lua" } },
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
	},
	config = function()
		local capabilities = get_capabilities()
		setup_lsp_handlers()
		local ensure_installed = get_ensure_installed(servers)
		require("mason-tool-installer").setup({ ensure_installed = ensure_installed })
		require("mason").setup()
		require("mason-lspconfig").setup({
			ensure_installed = ensure_installed,
			automatic_installation = false,
			handlers = { mason_handlers(servers, capabilities, on_attach) },
		})
		require("lazydev").setup({ capabilities = capabilities, on_attach })
		require("lsp-file-operations").setup()
	end,
}
