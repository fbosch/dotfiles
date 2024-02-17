return {
	"levouh/tint.nvim",
	event = "VeryLazy",
	-- enabled = false,
	config = function()
		require("tint").setup({
			show_first_indent_level = false,
			highlight_ignore_patterns = { "IndentBlankline*", "Ibl*", "Whitespace", "NonText" },
		})
	end,
}
