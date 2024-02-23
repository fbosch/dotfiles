return {
	{ "windwp/nvim-autopairs", event = { "InsertEnter" } },
	{ "monkoose/matchparen.nvim", event = { "InsertEnter" } },
	{ "tpope/vim-commentary", event = "BufRead" },
	{ "echasnovski/mini.surround", event = { "InsertEnter" } },
	{ "nguyenvukhang/nvim-toggler", event = { "BufReadPost" } },
	{
		"ray-x/sad.nvim",
		dependencies = { "ray-x/guihua.lua", run = "cd lua/fzy && make" },
		cmd = { "Sad" },
	},
	{
		-- json editing tools
		"gennaro-tedesco/nvim-jqx",
		ft = { "json", "yaml" },
		event = "BufWritePost",
	},
	{
		-- color picker
		"uga-rosa/ccc.nvim",
		cmd = "CccPick",
		event = { "BufRead" },
		keys = {
			{
				mode = { "n" },
				"<leader>pc",
				"<cmd>CccPick<cr>",
				desc = "pick color",
			},
		},
		opts = {
			highlighter = {
				highlight_mode = "fg",
				auto_enable = true,
			},
		},
	},
}
