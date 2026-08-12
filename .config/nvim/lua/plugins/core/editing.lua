local register = require("config.pack.registry").register

register({
	{
		name = "live-rename.nvim",
		src = "https://github.com/saecki/live-rename.nvim.git",
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
	},
	{
		name = "mini.ai",
		src = "https://github.com/echasnovski/mini.ai.git",
		opts = {},
	},
	{
		name = "nvim-toggler",
		src = "https://github.com/nguyenvukhang/nvim-toggler.git",
		opts = {},
	},
	{
		name = "nvim-surround",
		src = "https://github.com/kylechui/nvim-surround.git",
		version = "^3.0.0",
		opts = {},
	},
})

return {
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
