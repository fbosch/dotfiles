local platform = require("utils.platform")

local tsc_lsp_support = {}

local function find_tsc(root_dir)
	local dir = root_dir
	while dir ~= nil do
		local candidate = vim.fs.joinpath(dir, "node_modules", ".bin", "tsc")
		if vim.fn.executable(candidate) == 1 then
			return candidate
		end

		local parent = vim.fs.dirname(dir)
		if parent == nil or parent == dir then
			break
		end

		dir = parent
	end

	return "tsc"
end

local function tsc_supports_lsp(tsc)
	if tsc_lsp_support[tsc] ~= nil then
		return tsc_lsp_support[tsc]
	end

	if vim.fn.executable(tsc) ~= 1 then
		tsc_lsp_support[tsc] = false
		return false
	end

	local result = vim.system({ tsc, "--lsp", "--help" }, { text = true }):wait()
	tsc_lsp_support[tsc] = result.code == 0
	return tsc_lsp_support[tsc]
end

local function typescript_root(bufnr)
	local path = vim.api.nvim_buf_get_name(bufnr)
	if path == "" then
		return nil
	end

	if vim.fs.root(path, { "deno.json", "deno.jsonc" }) ~= nil then
		return nil
	end

	return vim.fs.root(path, {
		"package-lock.json",
		"yarn.lock",
		"pnpm-lock.yaml",
		"bun.lockb",
		"bun.lock",
		"tsconfig.json",
		"jsconfig.json",
		"package.json",
		".git",
	})
end

local servers = {
	ts_ls = {
		cmd = { "typescript-language-server", "--stdio" },
		root_dir = function(bufnr, on_dir)
			local root = typescript_root(bufnr)
			if root ~= nil and tsc_supports_lsp(find_tsc(root)) == false then
				on_dir(root)
			end
		end,
	},
	ts7 = {
		cmd = function(dispatchers, config)
			local tsc = find_tsc(config.root_dir)
			return vim.lsp.rpc.start({ tsc, "--lsp", "--stdio" }, dispatchers)
		end,
		filetypes = { "javascript", "javascriptreact", "typescript", "typescriptreact" },
		root_dir = function(bufnr, on_dir)
			local root = typescript_root(bufnr)
			if root ~= nil and tsc_supports_lsp(find_tsc(root)) then
				on_dir(root)
			end
		end,
	},
	tailwindcss = {
		cmd = { "tailwindcss-language-server", "--stdio" },
	},
	biome = {
		cmd = { "biome", "lsp-proxy" },
	},
	astro = {
		cmd = { "astro-ls", "--stdio" },
	},
	eslint = {
		cmd = { "vscode-eslint-language-server", "--stdio" },
	},
	html = {
		cmd = { "vscode-html-language-server", "--stdio" },
	},
	marksman = {
		cmd = { "marksman", "server" },
	},
	rust_analyzer = {
		cmd = { "rust-analyzer" },
	},
	fallow = {
		cmd = { "fallow-lsp" },
		filetypes = { "javascript", "typescript", "javascriptreact", "typescriptreact" },
		root_files = { ".fallowrc.json", "package.json", ".git" },
	},
	docker_compose_language_service = {
		cmd = { "docker-compose-langserver", "--stdio" },
	},
	cssls = {
		cmd = { "vscode-css-language-server", "--stdio" },
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
		local lsp_keymaps = require("config.keymaps.lsp")
		lsp_keymaps.setup(client, bufnr)
	end)
end

local on_attach = function(client, bufnr)
	attach_once(client, bufnr)
end

local function get_capabilities()
	return require("blink.cmp").get_lsp_capabilities({
		workspace = { didChangeWatchedFiles = { dynamicRegistration = false } },
		textDocument = { foldingRange = { dynamicRegistration = false, lineFoldingOnly = true } },
	})
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
		filetypes = server.filetypes,
		root_dir = resolve_root(server_name, server),
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

local function enable_servers(capabilities, on_attach)
	for server_name, server in pairs(servers) do
		if server.enabled ~= false and cmd_available(server) then
			vim.lsp.config(server_name, server_config(server_name, capabilities, on_attach))
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
	},
	config = function()
		if vim.lsp.document_color then
			vim.lsp.document_color.enable(false)
		end

		local capabilities = get_capabilities()
		enable_servers(capabilities, on_attach)
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
