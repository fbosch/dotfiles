return {
	"Fildo7525/pretty_hover",
	event = "LspAttach",
	config = function()
		require("pretty_hover").setup({
			border = "rounded",
		})
	end,
}
