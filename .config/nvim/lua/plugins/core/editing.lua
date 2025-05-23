return {
	{ "tpope/vim-repeat", event = "BufRead" },
	{ "smjonas/inc-rename.nvim", event = "BufRead", opts = {} },
	{ "windwp/nvim-autopairs", event = { "InsertEnter" }, opts = {} },
	{ "monkoose/matchparen.nvim", event = { "InsertEnter" }, opts = {} },
	{ "folke/ts-comments.nvim", event = "BufRead", opts = {} },
	{ "echasnovski/mini.surround", event = { "InsertEnter" }, opts = {} },
	{ "smjonas/live-command.nvim", event = "BufRead", opts = {} },
	{ "nguyenvukhang/nvim-toggler", event = { "BufReadPost" }, opts = {} },
	{
		-- structural search and replace
		"cshuaimin/ssr.nvim",
		opts = {
			adjust_window = true,
		},
		event = "VeryLazy",
		keys = {
			{
				"<leader>sr",
				"<cmd>lua require('ssr').open()<cr>",
				mode = { "n", "v" },
			},
		},
	},
	{
		-- find and replace
		"ray-x/sad.nvim",
		dependencies = { "ray-x/guihua.lua", run = "cd lua/fzy && make" },
		keys = { {
			"<leader>ra",
			"<cmd>Sad<cr>",
			mode = { "n" },
		} },
		cmd = { "Sad" },
		opts = {},
		enabled = true,
	},
	{
		"chrisgrieser/nvim-spider",
		event = "BufRead",
		keys = {
			{
				-- override motions for word, line and block to be sensetive to camelCase etc.
				"w",
				"<cmd>lua require('spider').motion('w')<CR>",
				mode = { "n", "o", "x" },
			},
			{
				"e",
				"<cmd>lua require('spider').motion('e')<CR>",
				mode = { "n", "o", "x" },
			},
			{
				"b",
				"<cmd>lua require('spider').motion('b')<CR>",
				mode = { "n", "o", "x" },
			},
		},
	},
}
