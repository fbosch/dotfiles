return {
	"jinh0/eyeliner.nvim",
	event = "VeryLazy",
	config = function()
		local colors = require("colors")
		vim.api.nvim_set_hl(0, "EyelinerPrimary", { fg = colors.blue, bold = true, underline = true })
		vim.api.nvim_set_hl(0, "EyelinerSecondary", { fg = colors.purple, underline = true })
		require("eyeliner").setup({
			highlight_on_key = true,
			dim = true,
		})
	end,
}
