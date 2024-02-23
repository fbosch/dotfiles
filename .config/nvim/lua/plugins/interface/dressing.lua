return {
	"stevearc/dressing.nvim",
	event = "VeryLazy",
	opts = {
		input = {
			enabled = true,
			border = "rounded",
			win_options = {
				winblend = 20,
			},
		},
		select = {
			enabled = true,
			backend = { "fzf_lua", "fzf", "builtin", "nui" },
			fzf_lua = {
				window = {
					width = 0.2,
					height = 0.2,
				},
			},
		},
	},
}
