return {
	{ "tpope/vim-repeat", event = "BufRead" },
	{ "smjonas/inc-rename.nvim", event = "BufRead", opts = {} },
	{ "windwp/nvim-autopairs", event = { "InsertEnter" }, opts = {} },
	-- { "m4xshen/autoclose.nvim", event = { "InsertEnter" }, opts = {} },
	{ "monkoose/matchparen.nvim", event = { "InsertEnter" }, opts = {} },
	{ "numToStr/Comment.nvim", event = "BufRead", opts = {} },
	{ "echasnovski/mini.surround", event = { "InsertEnter" }, opts = {} },
	{ "smjonas/live-command.nvim", event = "BufRead", opts = {} },
	{ "nguyenvukhang/nvim-toggler", event = { "BufReadPost" }, opts = {} },
	{
		"ecthelionvi/NeoComposer.nvim",
		dependencies = { "kkharji/sqlite.lua" },
		event = "VeryLazy",
		opts = {},
		enabled = false, -- clashes with keybinds
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
	},
	{
		-- json editing tools
		"gennaro-tedesco/nvim-jqx",
		ft = { "json", "yaml" },
		event = "BufWritePost",
	},
	{
		"MaximilianLloyd/tw-values.nvim",
		cmd = "TWValues",
		ft = { "typescript", "typescriptreact", "javascript", "javascriptreact" },
		keys = {
			{
				mode = "n",
				"<leader>tw",
				"<cmd>TWValues<cr>",
				desc = "tailwind values",
			},
		},
	},
}
