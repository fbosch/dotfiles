return {
	"dinhhuy258/git.nvim",
	event = "VeryLazy",
	keys = {
		{
			mode = { "n" },
			"<leader>gbo",
			"<cmd>GitBlameOpenCommitURL<CR>",
			desc = "git blame open commit url",
		},
		{
			mode = { "n" },
			"<leader>gbc",
			"<cmd>GitBlameCopySHA<CR>",
			desc = "git blame copy commit sha",
		},
	},
	config = function()
		require("git").setup()
	end,
}
