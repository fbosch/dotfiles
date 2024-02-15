return {
	"lukas-reineke/indent-blankline.nvim",
	-- version = "v2.20.8",
	event = "VeryLazy",
	config = function()
		require("ibl").setup({
			indent = { char = "▎" },
			scope = {
				char = "▎",
				enabled = true,
			},
		})
		-- indent blank line
		vim.api.nvim_set_hl(0, "IndentBlanklineScope", { fg = "#6e8aa5" })
		vim.api.nvim_set_hl(0, "IblScope", { fg = "#6e8aa5" })
	end,
}
