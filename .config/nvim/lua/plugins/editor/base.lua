return {
	{ "tpope/vim-repeat", event = "BufRead", config = true },
	{ "windwp/nvim-autopairs", event = { "InsertEnter" }, config = true },
	{ "m4xshen/autoclose.nvim", event = { "InsertEnter" }, config = true },
	{ "monkoose/matchparen.nvim", event = { "InsertEnter" }, config = true },
	{ "numToStr/Comment.nvim", event = "BufRead", config = true },
	{ "echasnovski/mini.surround", event = { "InsertEnter" }, config = true },
	{ "smjonas/live-command.nvim", event = "BufRead", config = true },
	{ "nguyenvukhang/nvim-toggler", event = { "BufReadPost" }, config = true },
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
		config = true,
	},
	{
		-- json editing tools
		"gennaro-tedesco/nvim-jqx",
		ft = { "json", "yaml" },
		event = "BufWritePost",
		config = true,
	},
}
