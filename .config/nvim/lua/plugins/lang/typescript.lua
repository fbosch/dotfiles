return {
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
		opts = {
			document_color = {
				inline_symbol = " ",
			},
		},
	},
	{
		-- dir = "~/Projects/js-i18n.nvim",
		"nabekou29/js-i18n.nvim",
		-- "fbosch/js-i18n.nvim",
		ft = { "javascript", "javascriptreact", "typescript", "typescriptreact" },
		lazy = true,
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
				"<leader>ine",
				"<cmd>I18nEditTranslation<cr>",
				desc = "Edit translation",
			},
		},
	},
}
