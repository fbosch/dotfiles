return {
	{
		"m-demare/hlargs.nvim",
		dependencies = {
			"nvim-treesitter/nvim-treesitter",
		},
		event = { "BufReadPre", "UIEnter", "LspAttach" },
		config = function()
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
