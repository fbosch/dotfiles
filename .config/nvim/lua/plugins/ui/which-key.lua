require("config.pack.registry").register({
	name = "which-key.nvim",
	src = "https://github.com/folke/which-key.nvim.git",
	events = { { "User", pattern = "PackReady" } },
	keys = {
		{
			"<leader>wk",
			function()
				vim.cmd.WhichKey()
			end,
			mode = "n",
			desc = "which-key",
		},
	},
	setup = function()
		local colors = require("config.colors")

		require("utils").load_highlights({
			WhichKey = { fg = colors.blue },
			WhichKeyGroup = { fg = colors.blue },
			WhichKeyDesc = { fg = colors.white },
			WhichKeySeperator = { fg = colors.light_gray },
			WhichKeyFloat = { bg = colors.background },
			WhichKeyValue = { fg = colors.light_gray },
		})

		require("which-key").setup({
			plugins = {
				registers = true,
				marks = true,
				spelling = {
					enabled = true,
					suggestions = 20,
				},
			},
			win = {
				border = "rounded",
			},
		})
	end,
})
