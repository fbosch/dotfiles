return {
	{
		"MaximilianLloyd/tw-values.nvim",
		cmd = "TWValues",
		ft = { "typescript", "typescriptreact", "javascript", "javascriptreact" },
		keys = {
			{
				mode = "n",
				"<leader>tw",
				"<cmd>TWValues<cr>",
				desc = "tailwind values",
			},
		},
	},
	{
		"dmmulroy/tsc.nvim",
		ft = { "typescript", "typescriptreact" },
		opts = {
			auto_close_qflist = true,
			auto_start_watch_mode = true,
			enable_progress_notifications = false,
			flags = { watch = false },
		},
	},
}
