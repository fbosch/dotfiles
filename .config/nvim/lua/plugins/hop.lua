return {
	"phaazon/hop.nvim",
	cmd = {
		"HopWord",
		"HopWordCurrentLine",
		"HowLineStart",
		"HopLineStartAC",
		"HopLineStartBC",
		"HopVertical",
	},
	config = function()
		require("hop").setup({
			keys = "etovxqpdygfblzhckisuran",
		})
	end,
}
