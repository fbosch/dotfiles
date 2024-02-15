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
		-- highlights
		vim.api.nvim_set_hl(0, "WhichKeyFloat", { bg = "#191919" })
		vim.api.nvim_set_hl(0, "WhichKey", { fg = "#97bdde" })

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
