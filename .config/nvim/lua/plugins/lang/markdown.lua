return {
	"toppair/peek.nvim",
	build = "deno task --quiet build:fast",
	ft = { "markdown" },
	config = function()
		require("peek").setup()
		vim.api.nvim_create_user_command("PeekOpen", require("peek").open, {})
		vim.api.nvim_create_user_command("PeekClose", require("peek").close, {})
	end,
	{
		"MeanderingProgrammer/render-markdown.nvim",
		dependencies = { "nvim-treesitter/nvim-treesitter" }, -- if you use the mini.nvim suite
		ft = { "markdown", "vimwiki" },
		config = function()
			require("render-markdown").setup({
				enabled = false,
				completions = { lsp = { enabled = true } },
				on = {
					attach = function()
						require("utils").load_highlights({
							RenderMarkdownCode = { bg = "NONE" },
						})
					end,
				},
			})
		end,
	},
}
