local platform = require("utils.platform")

local servers = {
	typescript = {
		enabled = false, -- use typescript-tools.nvim instead
	},
	ts_ls = {
		enabled = false, -- use typescript-tools.nvim instead
	},
	vtsls = {
		enabled = false, -- use typescript-tools.nvim instead
	},
	tsserver = {
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
	local diagnostic_close_events = {
		"BufLeave",
		"CursorMoved",
		"InsertEnter",
		"FocusLost",
	}

	local function open_diagnostic_float(bufnr, scope)
		vim.diagnostic.open_float(bufnr, {
			focusable = false,
			close_events = diagnostic_close_events,
			source = "if_many",
			scope = scope,
			border = "rounded",
			max_width = 100,
			max_height = 10,
		})
	end

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
		jump = {
			on_jump = function(diagnostic, bufnr)
				if diagnostic == nil then
					return
				end

				open_diagnostic_float(bufnr, "cursor")
			end,
		},
		float = {
			show_header = true,
			source = "if_many",
			border = "rounded",
			focusable = false,
			max_width = 100,
			max_height = 10,
			close_events = diagnostic_close_events,
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
			open_diagnostic_float(nil, "line")
		end,
	})
end

local lsp_keymaps = require("config.keymaps.lsp")
local attached_buffers = {}

local function attach_once(client, bufnr)
	if client == nil then
		return
	end

	attached_buffers[client.id] = attached_buffers[client.id] or {}
	if attached_buffers[client.id][bufnr] == true then
		return
	end

	attached_buffers[client.id][bufnr] = true
	setup_formatters(client, bufnr)
	-- Use vim.schedule to ensure keymaps are set after buffer is ready
	vim.schedule(function()
		lsp_keymaps.setup(client, bufnr)
	end)
end

local on_attach = function(client, bufnr)
	attach_once(client, bufnr)
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

	return ensure
end

local function root_dir_from_markers(markers)
	return function(bufnr)
		local path = vim.api.nvim_buf_get_name(bufnr)
		if path == "" then
			path = vim.loop.cwd()
		end
		return vim.fs.root(path, markers)
	end
end

local function resolve_root(server_name, server)
	if server_name == "eslint" then
		return root_dir_from_markers({
			"eslint.config.js",
			"eslint.config.cjs",
			"eslint.config.mjs",
			".eslintrc.js",
			".eslintrc.json",
			".eslintrc",
			".eslintrc.yml",
			".eslintrc.yaml",
		})
	end

	if server_name == "biome" then
		return root_dir_from_markers({ "biome.json", "biome.jsonc", ".git" })
	end

	if type(server.root_dir) == "function" then
		return server.root_dir
	end

	if type(server.root_files) == "table" and #server.root_files > 0 then
		return root_dir_from_markers(server.root_files)
	end
end

local function server_config(server_name, capabilities, on_attach)
	local server = servers[server_name] or {}
	local settings = server.settings or {}

	if server_name == "eslint" then
		settings = vim.tbl_deep_extend("force", settings, {
			experimental = { useFlatConfig = true },
		})
	end

	return {
		capabilities = vim.tbl_deep_extend("force", {}, capabilities, server.capabilities or {}),
		on_attach = on_attach,
		settings = settings,
		cmd = server.cmd,
		root_dir = resolve_root(server_name, server),
	}
end

local function mason_handlers(capabilities, on_attach)
	return function(server_name)
		local server = servers[server_name] or {}
		if server.enabled == false then
			pcall(vim.lsp.enable, server_name, false)
			return
		end

		vim.lsp.config(server_name, server_config(server_name, capabilities, on_attach))
		vim.lsp.enable(server_name)
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

local disabled_ts_servers = { "typescript", "ts_ls", "tsserver", "vtsls" }

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
		for _, server_name in ipairs(disabled_ts_servers) do
			pcall(vim.lsp.enable, server_name, false)
		end
		require("mason-tool-installer").setup({ ensure_installed = ensure_installed })
		require("mason").setup()
		require("mason-lspconfig").setup({
			ensure_installed = ensure_installed,
			automatic_installation = false,
			handlers = { mason_handlers(capabilities, on_attach) },
		})
		for _, server_name in ipairs(disabled_ts_servers) do
			pcall(vim.lsp.enable, server_name, false)
		end
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
					on_attach(client, bufnr)
				end
			end,
		})
	end,
}
