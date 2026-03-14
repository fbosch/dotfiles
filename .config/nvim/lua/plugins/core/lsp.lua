local platform = require("utils.platform")

local servers = {
	typescript = {
		enabled = false, -- use typescript-tools.nvim instead
	},
	tailwindcss = {
		cmd = { "tailwindcss-language-server", "--stdio" },
	},
	biome = {
		cmd = { "biome", "lsp-proxy" },
	},
	astro = {},
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
		cmd = platform.is_nixos() and { "lua-language-server" } or nil,
		settings = {
			Lua = {
				runtime = {
					version = "LuaJIT",
				},
				diagnostics = {
					globals = { "vim", "use" },
				},
				workspace = {
					checkThirdParty = false,
					library = {
						vim.env.VIMRUNTIME,
					},
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

local function setup_formatters(client, bufnr)
	local group = vim.api.nvim_create_augroup("LspFormatting", {})

	-- if client.name == "eslint" then
	-- 	vim.api.nvim_create_autocmd("BufWritePre", {
	-- 		buffer = bufnr,
	-- 		command = "EslintFixAll",
	-- 		group = group,
	-- 	})
	-- end
end

function setup_diagnostics()
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

local lsp_keymaps = require("config.keymaps.lsp")

local on_attach = function(client, bufnr)
	setup_formatters(client, bufnr)
	-- Use vim.schedule to ensure keymaps are set after buffer is ready
	vim.schedule(function()
		lsp_keymaps.setup(client, bufnr)
	end)
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

local function setup_codebook(capabilities, on_attach)
	if vim.fn.executable("codebook-lsp") == 0 then
		return
	end

	local codebook_config = {
		cmd = { "codebook-lsp", "serve" },
		filetypes = {
			"c",
			"css",
			"gitcommit",
			"go",
			"haskell",
			"html",
			"java",
			"javascript",
			"javascriptreact",
			"lua",
			"markdown",
			"php",
			"python",
			"ruby",
			"rust",
			"swift",
			"text",
			"toml",
			"typescript",
			"typescriptreact",
			"zig",
		},
		root_markers = { ".git", "codebook.toml", ".codebook.toml" },
		capabilities = capabilities,
		on_attach = on_attach,
	}

	if vim.lsp.config ~= nil and vim.lsp.enable ~= nil then
		vim.lsp.config("codebook", codebook_config)
		vim.lsp.enable("codebook")
		return
	end

	local ok_configs, configs = pcall(require, "lspconfig.configs")
	local ok_lspconfig, lspconfig = pcall(require, "lspconfig")
	if ok_configs == false or ok_lspconfig == false then
		return
	end

	if configs.codebook == nil then
		configs.codebook = {
			default_config = {
				cmd = codebook_config.cmd,
				filetypes = codebook_config.filetypes,
				root_dir = lspconfig.util.root_pattern(".git", "codebook.toml", ".codebook.toml"),
				single_file_support = true,
			},
		}
	end

	lspconfig.codebook.setup({
		capabilities = capabilities,
		on_attach = on_attach,
	})
end

local function get_ensure_installed()
	local ensure = {
		"eslint",
		"biome",
		"html",
		"marksman",
		"rust_analyzer",
		"docker_compose_language_service",
		"tailwindcss",
		"cssls",
	}

	if not platform.is_nixos() then
		table.insert(ensure, "lua_ls")
	end

	for name, config in pairs(servers) do
		if config.enabled ~= false and name ~= "lua_ls" then
			table.insert(ensure, name)
		end
	end

	if not platform.is_nixos() then
		table.insert(ensure, "lua_ls")
	end

	return ensure
end

-- Special handling for specific servers
local function mason_handlers(capabilities, on_attach)
	return function(server_name)
		local server = servers[server_name] or {}
		if server.enabled == false then
			return
		end
		local config = require("lspconfig")
		local settings = server.settings or {}

		print("LSP: " .. server_name)

		if server_name == "eslint" then
			settings.experimental = { useFlatConfig = true }
			config.eslint.setup({
				on_attach = on_attach,
				capabilities = capabilities,
				settings = settings,
				root_dir = config.util.root_pattern(
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
			config.biome.setup({
				on_attach = on_attach,
				capabilities = capabilities,
				settings = settings,
				cmd = server.cmd,
				root_dir = config.util.root_pattern("biome.json", "biome.jsonc", ".git"),
			})
			return
		end

		-- default lsp setup
		config[server_name].setup({
			capabilities = vim.tbl_deep_extend("force", {}, capabilities, server.capabilities or {}),
			on_attach = on_attach,
			settings = settings,
			cmd = server.cmd,
			root_dir = server.root_dir or config.util.root_pattern(server.root_files or {}),
		})
	end
end

local trigger_filetypes = {
	"astro",
	"css",
	"scss",
	"less",
	"sass",
	"html",
	"javascript",
	"javascriptreact",
	"json",
	"lua",
	"markdown",
	"rust",
	"typescript",
	"typescriptreact",
	"yaml",
}

return {
	"neovim/nvim-lspconfig",
	event = { "BufReadPre", "BufNewFile" },
	dependencies = {

		"antosha417/nvim-lsp-file-operations",
		"williamboman/mason-lspconfig.nvim",
		"WhoIsSethDaniel/mason-tool-installer.nvim",
		{
			"folke/lazydev.nvim",
			ft = { "lua" },
		},
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
			event = "LspAttach",
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
		{
			"pmizio/typescript-tools.nvim",
			ft = { "typescript", "typescriptreact", "javascript", "javascriptreact" },
			dependencies = { "nvim-lua/plenary.nvim", "neovim/nvim-lspconfig" },
			config = function()
				require("typescript-tools").setup({
					on_attach = on_attach,
					separate_diagnostic_server = true,
					publish_diagnostic_on = "insert_leave",
					complete_function_calls = false,
					settings = {
						tsserver_file_preferences = {
							importModuleSpecifierPreference = "non-relative",
							importModuleSpecifierEnding = "auto",
						},
					},
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
		local ensure_installed = get_ensure_installed()
		require("mason-tool-installer").setup({ ensure_installed = ensure_installed })
		require("mason").setup()
		require("mason-lspconfig").setup({
			ensure_installed = ensure_installed,
			automatic_installation = false,
			handlers = { mason_handlers(capabilities, on_attach) },
		})
		setup_codebook(capabilities, on_attach)
		require("lazydev").setup({ capabilities = capabilities, on_attach = on_attach })
		require("lsp-file-operations").setup()
		setup_diagnostics()

		-- Backup: Set keymaps via autocmd to ensure they're always set
		vim.api.nvim_create_autocmd("LspAttach", {
			group = vim.api.nvim_create_augroup("LspKeymapsAuto", { clear = true }),
			callback = function(args)
				local bufnr = args.buf
				local client = vim.lsp.get_client_by_id(args.data.client_id)
				if client then
					-- Use vim.schedule to ensure this runs after other plugins
					vim.schedule(function()
						on_attach(client, bufnr)
					end)
				end
			end,
		})
	end,
}
