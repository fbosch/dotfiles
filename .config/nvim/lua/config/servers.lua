return {
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
