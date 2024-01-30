return {
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
}
