return {
	"jinh0/eyeliner.nvim",
	event = "VeryLazy",
	config = function()
		vim.api.nvim_set_hl(0, "EyelinerPrimary", { fg = "#97bdde", bold = true, underline = true })
		vim.api.nvim_set_hl(0, "EyelinerSecondary", { fg = "#b279a7", underline = true })
		require("eyeliner").setup({
			highlight_on_key = true,
			dim = true,
		})
	end,
}
