return {
	-- replace with: https://github.com/folke/flash.nvim
	"phaazon/hop.nvim",
	branch = "v2",
	opts = {
		keys = "etovxqpdygfblzhckisuran",
	},
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
}
