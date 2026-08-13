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
	local root_dir = server.root_dir
	if server_name == "lua_ls" then
		root_dir = function(bufnr, on_dir)
			on_dir(require("lazydev").find_workspace(bufnr))
		end
	end

	return {
		capabilities = vim.tbl_deep_extend("force", {}, capabilities, server.capabilities or {}),
		settings = settings,
		cmd = server.cmd,
		filetypes = server.filetypes,
		root_markers = server.root_markers,
		root_dir = root_dir,
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

require("config.pack.registry").register({
	{
		name = "nvim-lsp-file-operations",
		src = "https://github.com/antosha417/nvim-lsp-file-operations.git",
		dependencies = { "plenary.nvim" },
		root = false,
	},
	{
		name = "lazydev.nvim",
		src = "https://github.com/folke/lazydev.nvim.git",
		root = false,
		setup = function()
			local pkg = require("lazydev.pkg")
			local registry = require("config.pack.registry")
			local lazy_unloaded = pkg.lazy_unloaded
			local lazy_plugin_path = pkg.get_plugin_path
			local find_roots = pkg.find_roots

			-- LazyDev otherwise ignores native opt packages while Lazy remains loaded.
			pkg.get_unloaded = function(modname)
				local paths = lazy_unloaded(modname)
				local seen = {}
				for _, path in ipairs(paths) do
					seen[path] = true
				end
				local active = {}
				for _, path in ipairs(vim.api.nvim_list_runtime_paths()) do
					active[vim.fs.normalize(path)] = true
				end
				for _, path in ipairs(pkg.pack_unloaded()) do
					local native_owned = registry.get(vim.fs.basename(path)) ~= nil
					if native_owned and seen[path] == nil and active[path] == nil then
						table.insert(paths, path)
						seen[path] = true
					end
				end
				return paths
			end

			pkg.get_plugin_path = function(name)
				local path = lazy_plugin_path(name)
				if path ~= nil then
					return path
				end
				if registry.get(name) == nil then
					return
				end
				for _, native_path in ipairs(pkg.pack_unloaded()) do
					if vim.fs.basename(native_path) == name then
						return native_path
					end
				end
			end

			pkg.find_roots = function(modname)
				local roots = {}
				local seen = {}
				for _, root in ipairs(find_roots(modname)) do
					if seen[root] == nil then
						table.insert(roots, root)
						seen[root] = true
					end
				end
				return roots
			end

			require("lazydev").setup({
				integrations = {
					lspconfig = false,
				},
			})
		end,
	},
	{
		name = "lspsaga.nvim",
		src = "https://github.com/nvimdev/lspsaga.nvim.git",
		root = false,
		module = "lspsaga",
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
	{
		name = "nvim-lspconfig",
		src = "https://github.com/neovim/nvim-lspconfig.git",
		events = { "BufReadPre", "BufNewFile" },
		dependencies = {
			"nvim-lsp-file-operations",
			"blink.cmp",
			"lazydev.nvim",
			"lspsaga.nvim",
		},
		setup = function()
			vim.lsp.document_color.enable(false)

			local capabilities = get_capabilities()
			enable_servers(capabilities)
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
	},
})

return {}
