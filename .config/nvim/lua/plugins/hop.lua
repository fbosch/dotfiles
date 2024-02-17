return {
	"phaazon/hop.nvim",
	opts = {
		keys = "etovxqpdygfblzhckisuran",
	},
	cmd = {
		"HopWord",
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
			"<cmd>HopWord<cr>",
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
			"<cmd>HopLineStart<cr>",
			desc = "hop to line start",
		},
		{
			mode = { "n" },
			"<leader>la",
			"<cmd>HopLineStartAC<cr>",
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
