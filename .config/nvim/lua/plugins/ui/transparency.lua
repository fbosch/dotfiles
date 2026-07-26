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
				end,
			})
		end,
	},
}
