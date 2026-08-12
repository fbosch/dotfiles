require("config.pack.registry").register({
	name = "live-rename.nvim",
	src = "https://github.com/saecki/live-rename.nvim.git",
	version = "205bddec4bf1276c81a03777f8335d4ad034ae03",
	keys = {
		{
			"<leader>rn",
			function()
				require("live-rename").rename({ insert = true, cursorpos = -1 })
			end,
			mode = "n",
			desc = "rename",
		},
	},
	setup = function()
		require("live-rename").setup({})
	end,
})

return {
	{ "echasnovski/mini.ai", version = "*", event = "VeryLazy", opts = {} },
	{ "tpope/vim-unimpaired", keys = { "]", "[" } },
	{ "tpope/vim-repeat", event = "BufEnter" },
	{ "windwp/nvim-autopairs", event = { "InsertEnter" }, opts = {} },
	{ "monkoose/matchparen.nvim", event = { "InsertEnter" }, opts = {} },
	{ "folke/ts-comments.nvim", event = "VeryLazy", opts = {} },
	{
		"tpope/vim-abolish",
		event = "InsertEnter",
		config = require("config.abbr").autofix_typos,
	},
	{
		"kylechui/nvim-surround",
		version = "^3.0.0",
		event = "VeryLazy",
		config = function()
			require("nvim-surround").setup({})
		end,
	},
	{ "nguyenvukhang/nvim-toggler", event = "VeryLazy", opts = {} },
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
