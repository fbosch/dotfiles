return {
	"stevearc/conform.nvim",
	ft = {
		"html",
		"css",
		"javascript",
		"javascriptreact",
		"typescript",
		"typescriptreact",
		"markdown",
		"json",
		"yaml",
		"lua",
		"fish",
		"rust",
		"mdx",
    "nix"
	},
	config = function()
		local group = vim.api.nvim_create_augroup("Conform", {})
		local conform = require("conform")
		local web_formatters = { "prettierd", "prettier", "biome", stop_after_first = true }
		conform.setup({
			default_format_options = {
				timeout = 1000,
				lsp_format = "fallback",
			},
		format_on_save = {
			quiet = true,
		},
		formatters = {
			biome = {
				-- Ensure biome uses the project's config by setting cwd to the file's directory
				cwd = require("conform.util").root_file({ "biome.json", "biome.jsonc" }),
			},
			["cargo fmt"] = {
				command = "cargo",
				args = { "fmt", "--", "--force" },
			},
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
				mdx = { "biome" },
				json = { "jq", "biome" },
				rust = { "cargo fmt" },
				yaml = { "prettierd", "prettier", stop_after_first = true },
				nix = { "nixfmt" },
			},
		})

		vim.api.nvim_create_autocmd("BufWritePre", {
			group = group,
			callback = function(args)
				if vim.fn.fnamemodify(args.file, ":t") == "todo.md" then
					return
				end
				conform.format({
					lsp_format = "fallback",
					quiet = true,
					async = true,
				})
			end,
		})
	end,
}
