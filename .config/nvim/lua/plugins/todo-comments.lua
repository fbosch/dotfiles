return {
	"folke/todo-comments.nvim",
	dependencies = {
		"nvim-lua/plenary.nvim",
	},
	event = "BufReadPost",
	config = function()
		require("todo-comments").setup()
	end,
}
