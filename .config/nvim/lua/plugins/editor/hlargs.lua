return {
	"m-demare/hlargs.nvim",
	dependencies = {
		"nvim-treesitter/nvim-treesitter",
	},
	config = function()
		local hlargs = require("hlargs")
		local colorpalette = {
			{ fg = "#9ec5cb" },
			{ fg = "#9f97ab" },
			{ fg = "#9dc0ab" },
			{ fg = "#f6c890" },
			{ fg = "#c6deb2" },
			{ fg = "#dfda97" },
			{ fg = "#f3ccd1" },
			{ fg = "#b9b0d8" },
			{ fg = "#c69eb6" },
			{ fg = "#96b492" },
			{ fg = "#80a9c8" },
			{ fg = "#e9b3aa" },
			{ fg = "#dcbdec" },
			{ fg = "#a1f2b5" },
			{ fg = "#f2e3a8" },
			{ fg = "#a8d0e6" },
			{ fg = "#f9a7c3" },
			{ fg = "#90dce5" },
			{ fg = "#efa998" },
			{ fg = "#cceaff" },
		}
		hlargs.setup({
			enabled = true,
			use_colorpalette = true,
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
