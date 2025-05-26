return {
	"toppair/peek.nvim",
	build = "deno task --quiet build:fast",
	ft = { "markdown" },
	event = "VeryLazy",
	config = function()
		require("peek").setup()
		vim.api.nvim_create_user_command("PeekOpen", require("peek").open, {})
		vim.api.nvim_create_user_command("PeekClose", require("peek").close, {})
	end,
	{
		"MeanderingProgrammer/render-markdown.nvim",
		dependencies = { "nvim-treesitter/nvim-treesitter" }, -- if you use the mini.nvim suite
		ft = { "markdown" },
		config = function()
			require("render-markdown").setup({
				completions = { lsp = { enabled = true } },
			})
			local colors = require("config.colors")
			local load_highlights = require("utils").load_highlights
			load_highlights({
				RenderMarkdownCode = { bg = "NONE" },
			})
		end,
	},
}
