return {
	"akinsho/git-conflict.nvim",
	event = { "BufRead" },
	config = function()
		require("git-conflict").setup()
	end,
}
