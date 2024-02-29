return {
	"m-demare/hlargs.nvim",
	dependencies = {
		"nvim-treesitter/nvim-treesitter",
	},
	config = function()
		local hlargs = require("hlargs")
		colorpalette = {
			{ fg = "#92a6a9" },
			{ fg = "#9f97ab" },
			{ fg = "#9dc0ab" },
			{ fg = "#f6c890" },
			{ fg = "#c6deb2" },
			{ fg = "#dfda97" },
			{ fg = "#f3ccd1" },
			{ fg = "#b9b0d8" },
			{ fg = "#af92a3" },
			{ fg = "#96b492" },
			{ fg = "#80a9c8" },
			{ fg = "#d9a8f2" },
			{ fg = "#e9b3aa" },
			{ fg = "#a1f2b5" },
			{ fg = "#f2e3a8" },
		}
		hlargs.setup({
			enabled = true,
			use_colorpalette = true,
			-- sequential_colorpalette = true,
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
