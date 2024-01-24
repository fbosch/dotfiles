return {
	"nvim-treesitter/nvim-treesitter",
	build = ":TSUpdate",
	dependencies = { "andymass/vim-matchup" },
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
}
