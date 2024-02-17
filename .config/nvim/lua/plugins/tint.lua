return {
	"levouh/tint.nvim",
	event = { "VeryLazy", "BufEnter" },
	priority = 1000,
	opts = {
		show_first_indent_level = false,
		highlight_ignore_patterns = { "IndentBlankline*", "Ibl*", "Whitespace", "NonText" },
	},
}
