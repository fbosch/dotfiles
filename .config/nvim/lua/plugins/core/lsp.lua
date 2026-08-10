local platform = require("utils.platform")

local servers = {
	tsgo = {},
	tailwindcss = {},
	biome = {},
	astro = {},
	eslint = {
		settings = {
			experimental = { useFlatConfig = true },
		},
	},
	html = {},
	marksman = {},
	rust_analyzer = {},
	fallow = {
		cmd = { "fallow-lsp" },
		filetypes = { "javascript", "typescript", "javascriptreact", "typescriptreact" },
		root_markers = {
			"pnpm-workspace.yaml",
			".fallowrc.json",
			".fallowrc.jsonc",
			"fallow.toml",
			".fallow.toml",
			".git",
		},
	},
	docker_compose_language_service = {},
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
		enabled = platform.is_nixos(),
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

function setup_diagnostics()
	local diagnostic_close_events = {
		"BufLeave",
		"CursorMoved",
		"CursorMovedI",
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

local function get_capabilities()
	local capabilities = require("lsp-file-operations").default_capabilities()
	capabilities = vim.tbl_deep_extend("force", capabilities, {
		workspace = { didChangeWatchedFiles = { dynamicRegistration = false } },
		textDocument = { foldingRange = { dynamicRegistration = false, lineFoldingOnly = true } },
	})

	return require("blink.cmp").get_lsp_capabilities(capabilities, true)
end

local function server_config(server_name, capabilities)
	local server = servers[server_name] or {}
	local settings = server.settings or {}

	return {
		capabilities = vim.tbl_deep_extend("force", {}, capabilities, server.capabilities or {}),
		settings = settings,
		cmd = server.cmd,
		filetypes = server.filetypes,
		root_markers = server.root_markers,
	}
end

local function cmd_available(server)
	if type(server.cmd) == "function" then
		return true
	end

	if server.cmd == nil or server.cmd[1] == nil then
		return true
	end

	return vim.fn.executable(server.cmd[1]) == 1
end

local function enable_servers(capabilities)
	for server_name, server in pairs(servers) do
		if server.enabled ~= false and cmd_available(server) then
			vim.lsp.config(server_name, server_config(server_name, capabilities))
			vim.lsp.enable(server_name)
		else
			pcall(vim.lsp.enable, server_name, false)
		end
	end
end

return {
	"neovim/nvim-lspconfig",
	event = { "BufReadPre", "BufNewFile" },
	dependencies = {

		"antosha417/nvim-lsp-file-operations",
		"saghen/blink.cmp",
		{
			"folke/lazydev.nvim",
			ft = { "lua" },
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
				symbol_in_winbar = {
					enable = false,
				},
				hover = {
					silent = true,
				},
			},
		},
	},
	config = function()
		vim.lsp.document_color.enable(false)

		local capabilities = get_capabilities()
		enable_servers(capabilities)
		require("lazydev").setup({ capabilities = capabilities })
		setup_diagnostics()

		vim.api.nvim_create_autocmd("LspAttach", {
			group = vim.api.nvim_create_augroup("LspKeymapsAuto", { clear = true }),
			callback = function(args)
				local bufnr = args.buf
				local client = vim.lsp.get_client_by_id(args.data.client_id)
				if client == nil then
					return
				end

				require("config.keymaps.lsp").setup(client, bufnr)
			end,
		})
	end,
}
