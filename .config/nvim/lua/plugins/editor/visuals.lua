return {
	{ "Bekaboo/deadcolumn.nvim", event = "VeryLazy" },
	{
		"petertriho/nvim-scrollbar",
		event = "VeryLazy",
		priority = 10,
		config = true,
	},
	{
		"folke/todo-comments.nvim",
		dependencies = {
			"nvim-lua/plenary.nvim",
		},
		event = { "BufRead" },
	},
	{
		"smjonas/live-command.nvim",
		event = "VeryLazy",
		priority = 10,
		config = function()
			require("live-command").setup({
				commands = {
					Norm = { cmd = "norm" },
				},
			})
		end,
	},
	{
		"levouh/tint.nvim",
		event = "VeryLazy",
		priority = 10,
		config = function()
			local tint = require("tint")
			local transforms = require("tint.transforms")
			local colors = require("colors")

			tint.setup({
				transforms = {
					transforms.tint_with_threshold(-40, colors.background, 100),
					transforms.saturate(0.4),
				},
				highlight_ignore_patterns = {
					"IndentBlankline*",
					"Ibl*",
					"Whitespace",
					"NonText",
					"Hop*",
					"Ccc*",
					"Leap*",
				},
			})
		end,
	},
	{
		"lukas-reineke/indent-blankline.nvim",
		event = "BufEnter",
		priority = 100,
		config = function()
			require("ibl").setup({
				indent = { char = "▏" },
				scope = {
					char = "▏",
					enabled = true,
				},
			})
		end,
	},
}
