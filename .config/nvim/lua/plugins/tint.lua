return {
	"levouh/tint.nvim",
	event = "VeryLazy",
	-- enabled = false,
	config = function()
		require("tint").setup({
			highlight_ignore_patterns = { "IndentBlankline*", "IblScope" },
		})
	end,
}
