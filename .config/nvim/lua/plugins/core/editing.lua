return {
	{ "echasnovski/mini.ai", version = "*", opts = {} },
	{ "tpope/vim-unimpaired", keys = { "]", "[" } },
	{ "tpope/vim-repeat", event = "BufEnter" },
	{ "windwp/nvim-autopairs", event = { "InsertEnter" }, opts = {} },
	{ "monkoose/matchparen.nvim", event = { "InsertEnter" }, opts = {} },
	{ "folke/ts-comments.nvim", event = "BufEnter", opts = {} },
	{
		"tpope/vim-abolish",
		event = "InsertEnter",
		config = require("config.abbr").autofix_typos,
	},
	{
		"smjonas/inc-rename.nvim",
		cmd = { "IncRename" },
		opts = {},
		keys = {
			{
				"<leader>rn",
				function()
					return ":IncRename " .. vim.fn.expand("<cword>")
				end,
				mode = "n",
				desc = "rename",
			},
		},
	},
	{
		"kylechui/nvim-surround",
		version = "^3.0.0",
		event = "VeryLazy",
		config = function()
			require("nvim-surround").setup({})
		end,
	},
	{ "nguyenvukhang/nvim-toggler", event = { "BufEnter" }, opts = {} },
	{
		"chrisgrieser/nvim-spider",
		event = { "BufEnter" },
		-- override motions for word, line and block to be sensitive to camelCase etc.
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
