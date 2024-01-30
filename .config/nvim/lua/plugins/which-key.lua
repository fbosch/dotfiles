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
		require("which-key").setup({
			plugins = {
				registers = true,
				marks = true,
				spelling = {
					enabled = true,
					suggestions = 20,
				},
			},
			window = {
				border = "rounded",
			},
		})
	end,
}
