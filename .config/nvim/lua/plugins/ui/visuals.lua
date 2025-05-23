return {
	{
		"m-demare/hlargs.nvim",
		dependencies = {
			"nvim-treesitter/nvim-treesitter",
		},
		event = "BufRead",
		enabled = true,
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
		config = true,
	},
	{
		"tzachar/local-highlight.nvim",
		event = { "VeryLazy", "BufWinEnter" },
		dependencies = {
			{
				"folke/snacks.nvim",
				opts = {
					animate = {},
					util = {},
					image = {
						enabled = false,
					},
				},
			},
		},
		config = function()
			require("local-highlight").setup({
				hlgroup = "LocalHighlight",
			})
		end,
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
			local colors = require("config.colors")

			tint.setup({
				transforms = {
					transforms.tint_with_threshold(-40, colors.background, 100),
					transforms.saturate(0.4),
				},
				highlight_ignore_patterns = {
					"NvimTree*",
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
