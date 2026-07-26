return {
	{
		"xiyaowong/transparent.nvim",
		lazy = false,
		priority = 999,
		config = function()
			local colors = require("config.colors")
			require("transparent").setup({
				on_clear = function()
					vim.api.nvim_set_hl(0, "NormalFloat", { bg = colors.background })
					local float_border = vim.api.nvim_get_hl(0, { name = "FloatBorder", link = false })
					float_border.bg = colors.background
					vim.api.nvim_set_hl(0, "FloatBorder", float_border)
				end,
			})
		end,
	},
}
