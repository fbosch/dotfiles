return {
	{
		"MaximilianLloyd/tw-values.nvim",
		cmd = "TWValues",
		enabled = false,
		ft = { "typescriptreact", "javascriptreact" },
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
		"luckasRanarison/tailwind-tools.nvim",
		build = ":UpdateRemotePlugins",
		ft = { "javascriptreact", "typescriptreact" },
		dependencies = {
			"nvim-treesitter/nvim-treesitter",
			"nvim-telescope/telescope.nvim",
			"neovim/nvim-lspconfig",
		},
		opts = {},
	},
	{
		-- dir = "~/Projects/js-i18n.nvim",
		"nabekou29/js-i18n.nvim",
		-- "fbosch/js-i18n.nvim",
		ft = { "javascript", "javascriptreact", "typescript", "typescriptreact" },
		cmd = { "I18nEditTranslation" },
		dependencies = {
			"neovim/nvim-lspconfig",
			"nvim-treesitter/nvim-treesitter",
			"nvim-lua/plenary.nvim",
		},
		opts = {
			key_separator = "?", -- allow for flattened json
			translation_source = { "**/{locales,messages}/**/*.json" }, -- Pattern for translation resources
			virt_text = {
				enabled = true,
			},
			diagnostic = {
				enabled = true,
			},
		},
		keys = {
			{
				mode = "n",
				"<leader>te",
				"<cmd>I18nEditTranslation<cr>",
				desc = "Edit translation",
			},
		},
	},
}
