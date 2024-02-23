return {
	{ "Bekaboo/deadcolumn.nvim", event = "VeryLazy" },
	{
		"petertriho/nvim-scrollbar",
		event = "BufRead",
	},
	{
		"folke/todo-comments.nvim",
		dependencies = {
			"nvim-lua/plenary.nvim",
		},
		event = { "BufReadPost", "ColorScheme" },
	},
	{
		"smjonas/live-command.nvim",
		event = "VeryLazy",
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
		event = { "VeryLazy", "BufEnter" },
		priority = 1000,
		opts = {
			show_first_indent_level = false,
			highlight_ignore_patterns = { "IndentBlankline*", "Ibl*", "Whitespace", "NonText", "Hop*" },
		},
	},
	{
		"stevearc/dressing.nvim",
		event = "VeryLazy",
		opts = {
			input = {
				enabled = true,
				border = "rounded",
				win_options = {
					winblend = 20,
				},
			},
			select = {
				enabled = true,
				backend = { "fzf_lua", "fzf", "builtin", "nui" },
				fzf_lua = {
					window = {
						width = 0.2,
						height = 0.2,
					},
				},
			},
		},
		{
			"lukas-reineke/indent-blankline.nvim",
			event = "VeryLazy",
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
		{
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
		},
	},
}
