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
		"roobert/tailwindcss-colorizer-cmp.nvim",
		ft = { "html", "css", "javascriptreact", "typescriptreact", "vue", "svelte" },
		enabled = false,
		config = function()
			require("tailwindcss-colorizer-cmp").setup({
				color_square_width = 2,
			})
		end,
	},
	{
		"razak17/tailwind-fold.nvim",
		ft = { "html", "css", "javascriptreact", "typescriptreact", "vue", "svelte" },
		dependencies = { "nvim-treesitter/nvim-treesitter" },
		enabled = false, -- Disabled: nil value error when switching buffers in .tsx files
		opts = {
			min_chars = 50, -- Only fold classes longer than 50 chars
		},
	},
	{
		-- dir = "~/Projects/js-i18n.nvim",
		"nabekou29/js-i18n.nvim",
		-- "fbosch/js-i18n.nvim",
		ft = { "javascript", "javascriptreact", "typescript", "typescriptreact" },
		enabled = false,
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
