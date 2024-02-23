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
}
