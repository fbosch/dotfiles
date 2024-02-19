return {
	{
		"nvim-treesitter/nvim-treesitter",
		build = ":TSUpdate",
		dependencies = { { "andymass/vim-matchup", event = { "VeryLazy" } }, "windwp/nvim-ts-autotag" },
		event = { "BufReadPost", "BufNewFile", "LspAttach" },
		config = function()
			require("nvim-treesitter.configs").setup({
				matchup = {
					enable = true,
				},
				auto_install = true,
				additional_vim_regex_highlighting = false,
				autopairs = { enable = true },
				autotag = { enable = true },
				ensure_installed = {
					"javascript",
					"jsdoc",
					"typescript",
					"html",
					"css",
					"markdown",
					"yaml",
					"regex",
					"vim",
				},
				highlight = { enable = true },
				indent = { enable = true },
			})
		end,
	},
	{
		"nvim-treesitter/nvim-treesitter-context",
		event = { "LspAttach", "BufWinEnter" },
		config = vim.schedule_wrap(function()
			local colors = require("colors")
			-- highlight
			vim.api.nvim_set_hl(0, "TreesitterContext", { bg = colors.darkest_gray })
			vim.api.nvim_set_hl(0, "TreesitterContextLineNumber", { bg = colors.darkest_gray })
			vim.api.nvim_set_hl(
				0,
				"TreesitterContextBottom",
				{ bg = colors.darkest_gray, underline = true, sp = colors.dark_gray }
			)

			require("nvim-treesitter.configs").setup({
				context = {
					enable = true, -- Enable this plugin (Can be enabled/disabled later via commands)
					throttle = true, -- Throttles plugin updates (may improve performance)
				},
			})
		end),
	},
}
