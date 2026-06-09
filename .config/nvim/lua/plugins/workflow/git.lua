local is_git_repo = require("utils.git").is_git_repo()
return {
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
				"<Plug>(git-conflict-ours)",
				desc = "git conflict choose ours",
			},
			{
				mode = { "n" },
				"<leader>gct",
				"<Plug>(git-conflict-theirs)",
				desc = "git conflict choose theirs",
			},
			{
				mode = { "n" },
				"<leader>gcb",
				"<Plug>(git-conflict-both)",
				desc = "git conflict choose both",
			},
			{
				mode = { "n" },
				"<leader>gc0",
				"<Plug>(git-conflict-none)",
				desc = "git conflict choose none",
			},
			{
				mode = { "n" },
				"<leader>gcn",
				"<Plug>(git-conflict-next-conflict)",
				desc = "git conflict next",
			},
			{
				mode = { "n" },
				"<leader>gcp",
				"<Plug>(git-conflict-prev-conflict)",
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
			current_line_blame = true,
			current_line_blame_opts = {
				virt_text = false,
				delay = 100,
			},
			current_line_blame_formatter = " <author>   <author_time:%R>   <abbrev_sha> ",
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
			{
				mode = { "n", "v" },
				"<leader>gh",
				":Gitsigns select_hunk<CR>",
				desc = "git select hunk",
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
