return {
	{
		"nvim-treesitter/nvim-treesitter",
		build = ":TSUpdate",
		event = "VeryLazy",
		dependencies = {
			{ "andymass/vim-matchup", enabled = false },
			{ "nvim-treesitter/nvim-treesitter-context", enabled = false },
			"windwp/nvim-ts-autotag",
		},
		ft = { "rust", "javascript", "typescript", "tsx", "html", "css", "markdown", "yaml", "vim", "help" },
		config = function()
			require("nvim-treesitter.configs").setup({
				modules = {},
				ignore_install = {},
				context = { enable = true },
				matchup = { enable = false },
				sync_install = true,
				auto_install = true,
				additional_vim_regex_highlighting = false,
				autopairs = { enable = true },
				autotag = { enable = true },
				highlight = { enable = true },
				indent = { enable = true },
				incremental_selection = {
					enable = true,
					keymaps = {
						node_incremental = "v",
						node_decremental = "V",
					},
				},
				ensure_installed = {
					"rust",
					"javascript",
					"jsdoc",
					"typescript",
					"tsx",
					"html",
					"css",
					"markdown",
					"yaml",
					"regex",
					"vim",
					"vimdoc",
				},
			})
		end,
	},
	{
		"Wansmer/treesj",
		keys = {
			{
				"<leader>m",
				"<cmd>TSJToggle<CR>",
				mode = { "n" },
			},
		},
		cmd = { "TSJToggle" },
		dependencies = { "nvim-treesitter/nvim-treesitter" },
		opts = {
			use_default_keymaps = false,
		},
	},
	{
		"aaronik/treewalker.nvim",
		keys = {
			{
				"<C-k>",
				"<cmd>Treewalker Up<CR>",
				mode = { "n", "x" },
				desc = "Treewalker up",
				silent = true,
			},
			{
				"<C-j>",
				"<cmd>Treewalker Down<CR>",
				mode = { "n", "x" },
				desc = "Treewalker down",
				silent = true,
			},
			{
				"<C-A-k>",
				"<cmd>Treewalker SwapUp<CR>",
				mode = { "n" },
				desc = "Treewalker swap up",
				silent = true,
			},
			{
				"<C-A-j>",
				"<cmd>Treewalker SwapDown<CR>",
				mode = { "n" },
				desc = "Treewalker swap down",
				silent = true,
			},
			{
				"<C-A-h>",
				"<cmd>Treewalker SwapLeft<CR>",
				mode = { "n" },
				desc = "Treewalker swap left",
				silent = true,
			},
			{
				"<C-A-l>",
				"<cmd>Treewalker SwapRight<CR>",
				mode = { "n" },
				desc = "Treewalker swap right",
				silent = true,
			},
		},
		cmd = { "Treewalker" },
		opts = {},
	},
}
