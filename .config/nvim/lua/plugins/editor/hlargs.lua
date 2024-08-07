return {
	"m-demare/hlargs.nvim",
	dependencies = {
		"nvim-treesitter/nvim-treesitter",
	},
	event = "BufRead",
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
			{ fg = "#cceaff" },
			{ fg = "#7aacb7" },
			{ fg = "#66d9ef" },
			{ fg = "#dfd096" },
			{ fg = "#c5cae9" },
			{ fg = "#87c38f" },
			{ fg = "#e5d8b6" },
			{ fg = "#9c89b8" },
			{ fg = "#ffd28a" },
			{ fg = "#a3bffa" },
			{ fg = "#b3a2c7" },
			{ fg = "#93c5b4" },
			{ fg = "#66b3a7" },
			{ fg = "#e5d7b2" },
			{ fg = "#ffbdb7" },
			{ fg = "#a4c0c9" },
			{ fg = "#bfaecd" },
			{ fg = "#f9a7c3" },
			{ fg = "#90dce5" },
			{ fg = "#cceaff" },
			{ fg = "#8fbcbb" },
			{ fg = "#ffd7be" },
			{ fg = "#66d9ef" },
			{ fg = "#ff99cc" },
			{ fg = "#ccb3ff" },
			{ fg = "#33ccff" },
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
