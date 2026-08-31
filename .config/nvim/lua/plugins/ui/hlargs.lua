return {
	{
		name = "hlargs.nvim",
		src = "https://github.com/m-demare/hlargs.nvim.git",
		dependencies = {
			"nvim-treesitter",
		},
		events = { "BufReadPre", "BufNewFile", "LspAttach" },
		setup = function()
			local hlargs = require("hlargs")
			local colors = require("config.colors")
			local colorpalette = {}
			for _, color in ipairs(colors.highlight_args) do
				table.insert(colorpalette, { fg = color })
			end
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
	},
}
