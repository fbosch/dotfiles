return {
	"m-demare/hlargs.nvim",
	dependencies = {
		"nvim-treesitter/nvim-treesitter",
	},
	config = function()
		local hlargs = require("hlargs")
		local colorpalette = {
			{ fg = "#699a9b" },
			{ fg = "#83699b" },
			{ fg = "#71d0a9" },
			{ fg = "#CA9F35" },
			{ fg = "#a9d071" },
			{ fg = "#9b6981" },
			{ fg = "#59a868" },
			{ fg = "#ded16e" },
			{ fg = "#ff93c8" },
			{ fg = "#6e62de" },
			{ fg = "#C5653A" },
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
