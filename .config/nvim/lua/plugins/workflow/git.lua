return {
	{
		"dinhhuy258/git.nvim",
		cmd = {
			"GitBlameOpenCommitURL",
			"GitBlameCopySHA",
		},
		keys = {
			{
				"<leader>gbo",
				"<cmd>GitBlameOpenCommitURL<CR>",
				desc = "git blame open commit url",
				mode = { "n" },
			},
			{
				"<leader>gbc",
				"<cmd>GitBlameCopySHA<CR>",
				desc = "git blame copy commit sha",
				mode = { "n" },
			},
		},
		opts = {
			keymaps = {
				blame_line = "gbc",
				blame_tree = "gbt",
			},
		},
	},
	{
		"akinsho/git-conflict.nvim",
		event = "BufReadPost",
		opts = {
			highlights = {
				incoming = "DiffAdd",
				outgoing = "DiffDelete",
			},
		},
	},
	{
		"lewis6991/gitsigns.nvim",
		event = { "BufReadPost" },
		opts = {
			signs = {
				add = { text = "+▕" },
				change = { text = "~▕" },
				delete = { text = "-▕" },
				topdelete = { text = "‾" },
				changedelete = { text = "~" },
			},
		},
	},
	{
		"sindrets/diffview.nvim",
		dependencies = { "nvim-lua/plenary.nvim" },
		keys = {
			{
				mode = { "n" },
				"<leader>dff",
				"<cmd>DiffviewOpen<cr>",
				desc = "diff view open",
			},
			{
				mode = { "n" },
				"<leader>dfq",
				"<cmd>DiffviewClose<cr>",
				desc = "diff view close",
			},
		},
		cmd = {
			"DiffviewOpen",
			"DiffviewClose",
		},
	},
}
