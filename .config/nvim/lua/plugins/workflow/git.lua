local is_git_repo = require("utils.git").is_git_repo()
return {
	{
		"dinhhuy258/git.nvim",
		cmd = {
			"GitBlameOpenCommitURL",
			"GitBlameCopySHA",
		},
		cond = is_git_repo,
		keys = {
			{
				"<leader>gBo",
				"<cmd>GitBlameOpenCommitURL<CR>",
				desc = "git blame open commit url",
				mode = { "n" },
			},
			{
				"<leader>gBc",
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
		cond = is_git_repo,
		opts = {
			highlights = {
				incoming = "DiffAdd",
				outgoing = "DiffDelete",
			},
		},
	},
	{
		"lewis6991/gitsigns.nvim",
		event = { "BufReadPost", "BufNewFile", "BufWritePost" },
		cond = is_git_repo,
		opts = {
			signs = {
				add = { text = "+▕" },
				change = { text = "~▕" },
				delete = { text = "-▕" },
				topdelete = { text = "‾" },
				changedelete = { text = "~" },
			},
			preview_config = {
				border = "rounded",
				style = "minimal",
				relative = "cursor",
				col = 3,
				row = -3,
			},
		},
		keys = {
			{
				mode = { "n" },
				"<leader>gs",
				":Gitsigns stage_buffer<CR>",
				desc = "git stage buffer",
			},
			{
				mode = { "n" },
				"<leader>grb",
				":Gitsigns reset_buffer<CR>",
				desc = "git reset buffer",
			},
			{
				mode = { "n" },
				"<leader>grh",
				":Gitsigns reset_hunk<CR>",
				desc = "git reset hunk",
			},
			{
				mode = { "n" },
				"<leader>gn",
				":Gitsigns next_hunk<CR>",
				desc = "git next hunk",
			},
			{
				mode = { "n" },
				"<leader>gN",
				":Gitsigns prev_hunk<CR>",
				desc = "git previous hunk",
			},
			{
				mode = { "n" },
				"<leader>gb",
				":Gitsigns blame_line<CR>",
				desc = "git blame line",
			},
			{
				mode = { "n" },
				"<leader>gB",
				":Gitsigns blame<CR>",
				desc = "git blame",
			},
		},
	},
	{
		"sindrets/diffview.nvim",
		dependencies = { "nvim-lua/plenary.nvim" },
		cond = is_git_repo,
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
