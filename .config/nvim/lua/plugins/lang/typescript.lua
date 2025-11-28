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
	-- Tailwind CSS tooling
	-- Note: tailwind-tools.nvim was archived by author on Aug 29, 2024
	-- Alternative options:
	-- 1. tailwindcss-colorizer-cmp.nvim (368⭐) - color hints in completion
	-- 2. tailwind-fold.nvim (95⭐) - conceal long class attributes
	-- 3. tailwind-sorter.nvim (159⭐) - sort classes without prettier
	-- 4. themaxmarchuk/tailwindcss-colors.nvim (57⭐) - highlights when LSP connected
	{
		"roobert/tailwindcss-colorizer-cmp.nvim",
		ft = { "html", "css", "javascriptreact", "typescriptreact", "vue", "svelte" },
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
