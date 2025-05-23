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
		-- highlights
		vim.api.nvim_set_hl(0, "WhichKeyFloat", { bg = colors.background })
		vim.api.nvim_set_hl(0, "WhichKey", { fg = colors.blue })

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
