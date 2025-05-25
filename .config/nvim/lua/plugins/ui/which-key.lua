return {
	"folke/which-key.nvim",
	event = "VeryLazy",
	keys = {
		{
			mode = "n",
			"<leader>wk",
			"<cmd>WhichKey<CR>",
			desc = "which-key",
		},
	},
	config = function()
		local colors = require("config.colors")

		require("utils").load_highlights({
			WhichKey = { fg = colors.blue },
			WhichKeyGroup = { fg = colors.blue },
			WhichKeyDesc = { fg = colors.white },
			WhichKeySeperator = { fg = colors.light_gray },
			WhichKeyFloat = { bg = colors.background },
			WhichKeyValue = { fg = colors.light_gray },
		})

		require("which-key").setup({
			plugins = {
				registers = true,
				marks = true,
				spelling = {
					enabled = true,
					suggestions = 20,
				},
			},
			win = {
				border = "rounded",
			},
		})
	end,
}
