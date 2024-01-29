return {
	"lewis6991/gitsigns.nvim",
	event = { "InsertEnter", "BufRead" },
	config = function()
		require("gitsigns").setup()
	end,
}
