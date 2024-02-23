return {
	{ "tpope/vim-unimpaired", event = "VeryLazy" },
	{
		"jinh0/eyeliner.nvim",
		event = "VeryLazy",
		config = function()
			local colors = require("colors")
			vim.api.nvim_set_hl(0, "EyelinerPrimary", { fg = colors.blue, bold = true, underline = true })
			vim.api.nvim_set_hl(0, "EyelinerSecondary", { fg = colors.purple, underline = true })
			require("eyeliner").setup({
				highlight_on_key = true,
				dim = true,
			})
		end,
	},
	{
		"phaazon/hop.nvim",
		branch = "v2",
		config = function()
			require("hop").setup({
				keys = "etovxqpdygfblzhckisuran",
			})
		end,
		cmd = {
			"HopWord",
			"HopWordMW",
			"HopWordCurrentLine",
			"HowLineStart",
			"HopLineStartAC",
			"HopLineStartBC",
			"HopVertical",
		},
		keys = {
			{
				mode = { "n" },
				"<leader>h",
				"<cmd>HopWordMW<cr>",
				desc = "hop to word",
			},
			{
				mode = { "n" },
				"<leader>cl",
				"<cmd>HopWordCurrentLine<cr>",
				desc = "hop to word in current line",
			},
			{
				mode = { "n" },
				"<leader>lh",
				"<cmd>HopLineStartMW<cr>",
				desc = "hop to line start",
			},
			{
				mode = { "n" },
				"<leader>la",
				"<cmd>HopLineStartMW<cr>",
				desc = "hop to line start after character",
			},
			{
				mode = { "n" },
				"<leader>lb",
				"<cmd>HopLineStartBC<cr>",
				desc = "hop to line start before character",
			},
			{
				mode = { "n" },
				"<leader>vh",
				"<cmd>HopVertical<cr>",
				desc = "hop to vertical",
			},
		},
	},
}
