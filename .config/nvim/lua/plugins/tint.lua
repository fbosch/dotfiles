return {
	"levouh/tint.nvim",
	event = "ColorScheme",
	enabled = false,
	config = function()
		require("tint").setup()
	end,
}
