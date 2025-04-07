return {
	"stevearc/dressing.nvim",
	event = "VeryLazy",
	opts = {
		input = {
			insert_only = false,
			enabled = true,
			border = "rounded",
			win_options = {
				winblend = 20,
			},
			override = function(conf)
				conf.col = -1
				conf.row = 0
				return conf
			end,
		},
		elect = {
			enabled = true,
			backend = { "fzf_lua", "fzf", "builtin", "nui" },
			trim_prompt = true,
			fzf_lua = {
				window = {
					width = 0.2,
					height = 0.2,
				},
			},
		},
	},
}
