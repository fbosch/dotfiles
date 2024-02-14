return {
	"nvim-treesitter/nvim-treesitter-context",
	event = "LspAttach",
	config = function()
		require("nvim-treesitter.configs").setup({
			context = {
				enable = true, -- Enable this plugin (Can be enabled/disabled later via commands)
				throttle = true, -- Throttles plugin updates (may improve performance)
			},
		})
	end,
}
