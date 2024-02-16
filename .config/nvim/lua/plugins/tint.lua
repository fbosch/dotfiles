return {
	"levouh/tint.nvim",
	event = "VeryLazy",
	enabled = false,
	config = function()
		require("tint").setup()
	end,
}
