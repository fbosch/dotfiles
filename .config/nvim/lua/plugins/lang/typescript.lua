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
		cmd = { "TSCOpen", "TSCClose", "TSCRestart", "TSCToggle" },
		opts = {
			auto_close_qflist = true,
			auto_start_watch_mode = true,
			enable_progress_notifications = false,
			flags = { watch = false },
		},
	},
	{
		"nabekou29/js-i18n.nvim",
		ft = { "javascript", "javascriptreact", "typescript", "typescriptreact" },
		event = { "BufReadPre", "BufNewFile" },
		enabled = false, -- TODO: fix this
		dependencies = {
			"neovim/nvim-lspconfig",
			"nvim-treesitter/nvim-treesitter",
			"nvim-lua/plenary.nvim",
		},
		opts = {
			translation_source = { "**/{locales,messages}/**/*.json" }, -- Pattern for translation resources
			virt_text = {
				enabled = false,
			},
			diagnostic = {
				enabled = true,
			},
		},
	},
}
