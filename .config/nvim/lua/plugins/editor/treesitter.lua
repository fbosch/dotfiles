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
						init_selection = false,
						node_incremental = "v",
						node_decremental = "V",
						scope_incremental = false,
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
}
