return {
	"monkoose/matchparen.nvim",
	event = { "InsertEnter" },
	config = function()
		require("matchparen").setup({})
	end,
}
