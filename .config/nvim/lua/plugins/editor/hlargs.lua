return {
	"m-demare/hlargs.nvim",
	dependencies = {
		"nvim-treesitter/nvim-treesitter",
	},
	config = function()
		local hlargs = require("hlargs")
		local colorpalette = {
			{ fg = "#8cabaf" },
			{ fg = "#9e8eb4" },
			{ fg = "#91cca9" },
			{ fg = "#f6c890" },
			{ fg = "#c6e5ab" },
			{ fg = "#b5899c" },
			{ fg = "#a0ca8c" },
			{ fg = "#e9dd8d" },
			{ fg = "#ffc0c8" },
			{ fg = "#ac98f0" },
			{ fg = "#d18d6f" },
			{ fg = "#d071a9" },
			{ fg = "#5cc565" },
			{ fg = "#3566af" },
			{ fg = "#bf528c" },
		}
		hlargs.setup({
			enabled = true,
			use_colorpalette = true,
			sequential_colorpalette = true,
			paint_catch_blocks = {
				declarations = true,
				usages = true,
			},
			extras = {
				named_parameters = true,
			},
			colorpalette = colorpalette,
			hl_priority = 300,
		})
	end,
}
