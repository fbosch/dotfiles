return {
	"stevearc/conform.nvim",
	event = { "BufEnter", "BufWinEnter" },
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
				json = { "jq", "biome format" },
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
}
