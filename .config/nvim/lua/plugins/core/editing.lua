return {
	{ "tpope/vim-repeat", event = "BufEnter" },
	{ "smjonas/inc-rename.nvim", event = "BufEnter", opts = {} },
	{ "windwp/nvim-autopairs", event = { "InsertEnter" }, opts = {} },
	{ "monkoose/matchparen.nvim", event = { "InsertEnter" }, opts = {} },
	{ "folke/ts-comments.nvim", event = "BufEnter", opts = {} },
	{ "echasnovski/mini.surround", event = { "InsertEnter" }, opts = {} },
	{ "nguyenvukhang/nvim-toggler", event = { "BufEnter" }, opts = {} },
	{
		"chrisgrieser/nvim-spider",
		event = { "BufEnter" },
		-- override motions for word, line and block to be sensetive to camelCase etc.
		keys = {
			{
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
