return {
	{ "tpope/vim-repeat", event = "BufRead" },
	{ "windwp/nvim-autopairs", event = { "InsertEnter" } },
	{ "monkoose/matchparen.nvim", event = { "InsertEnter" } },
	-- { "tpope/vim-commentary", event = "BufRead" },
	{ "numToStr/Comment.nvim", event = "BufRead", config = true },
	{ "echasnovski/mini.surround", event = { "InsertEnter" } },
	{ "nguyenvukhang/nvim-toggler", event = { "BufReadPost" }, config = true },
	{
		-- find and replace
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
}
