return {
	"windwp/nvim-autopairs",
	event = { "InsertEnter", "BufRead" },
	config = function()
		require("nvim-autopairs").setup({})
	end,
}
