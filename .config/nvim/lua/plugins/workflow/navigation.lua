return {
	{ "tpope/vim-unimpaired", event = "VeryLazy" },
	{
		"jinh0/eyeliner.nvim",
		config = function()
			local colors = require("colors")
			require("eyeliner").setup({
				highlight_on_key = true,
				dim = true,
			})
			vim.api.nvim_set_hl(0, "EyelinerPrimary", { fg = colors.blue, bold = true, underline = true })
			vim.api.nvim_set_hl(0, "EyelinerSecondary", { fg = colors.purple, underline = true })
			vim.api.nvim_set_hl(0, "EyelinerDimmed", { fg = colors.search_backdrop })
		end,
	},
	{
		"ggandor/leap.nvim",
		event = "VeryLazy",
		keys = {
			{ "s", mode = { "n", "x", "o" }, desc = "Leap forward to" },
			{ "S", mode = { "n", "x", "o" }, desc = "Leap backward to" },
			{ "gs", mode = { "n", "x", "o" }, desc = "Leap from windows" },
		},
		config = function(_, opts)
			local leap = require("leap")
			for k, v in pairs(opts) do
				leap.opts[k] = v
			end
			leap.add_default_mappings(true)
		end,
	},
}
