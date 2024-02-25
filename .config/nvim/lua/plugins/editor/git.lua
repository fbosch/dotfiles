return {
	{
		"kdheepak/lazygit.nvim",
		dependencies = { "nvim-telescope/telescope.nvim" },
		keys = {
			{
				mode = { "n" },
				"<leader>gg",
				"<cmd>LazyGit<cr>",
				desc = "lazygit",
			},
		},
		cmd = { "LazyGit" },
		config = function()
			local telescope = require("telescope")
			telescope.load_extension("lazygit")
		end,
	},
	{

		"dinhhuy258/git.nvim",
		cmd = {
			"GitBlameOpenCommitURL",
			"GitBlameCopySHA",
		},
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
			require("git").setup({
				keymaps = {
					diff = "<leader>df",
					diff_close = "<leader>dF",
				},
			})
		end,
	},
	{
		"akinsho/git-conflict.nvim",
		event = { "BufRead" },
	},
	{
		"lewis6991/gitsigns.nvim",
		event = { "BufRead" },
		config = function()
			require("gitsigns").setup()
		end,
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
