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
			default_mappings = {
				ours = "co", -- choose current (ours)
				theirs = "ct", -- choose incoming (theirs)
				both = "cb", -- choose both changes
				none = "c0", -- choose none (delete conflict)
				prev = "[x", -- go to previous conflict
				next = "]x", -- go to next conflict
			},
			highlights = {
				incoming = "DiffAdd",
				current = "DiffDelete",
			},
		},
		keys = {
			{
				mode = { "n" },
				"<leader>gco",
				"<cmd>GitConflictChooseOurs<CR>",
				desc = "git conflict choose ours",
			},
			{
				mode = { "n" },
				"<leader>gct",
				"<cmd>GitConflictChooseTheirs<CR>",
				desc = "git conflict choose theirs",
			},
			{
				mode = { "n" },
				"<leader>gcb",
				"<cmd>GitConflictChooseBoth<CR>",
				desc = "git conflict choose both",
			},
			{
				mode = { "n" },
				"<leader>gc0",
				"<cmd>GitConflictChooseNone<CR>",
				desc = "git conflict choose none",
			},
			{
				mode = { "n" },
				"<leader>gcn",
				"<cmd>GitConflictNextConflict<CR>",
				desc = "git conflict next",
			},
			{
				mode = { "n" },
				"<leader>gcp",
				"<cmd>GitConflictPrevConflict<CR>",
				desc = "git conflict previous",
			},
			{
				mode = { "n" },
				"<leader>gcl",
				"<cmd>GitConflictListQf<CR>",
				desc = "git conflict list in quickfix",
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
