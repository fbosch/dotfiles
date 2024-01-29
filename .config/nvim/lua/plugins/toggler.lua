return {
	"nguyenvukhang/nvim-toggler",
	event = { "BufReadPost" },
	config = function()
		require("nvim-toggler").setup({})
	end,
}
