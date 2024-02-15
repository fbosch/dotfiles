return {
	"nvim-treesitter/nvim-treesitter-context",
	event = "LspAttach",
	config = function()
		-- highlight
		vim.api.nvim_set_hl(0, "TreesitterContext", { bg = "#1d1d1d" })
		vim.api.nvim_set_hl(0, "TreesitterContextLineNumber", { bg = "#1d1d1d" })
		vim.api.nvim_set_hl(0, "TreesitterContextBottom", { bg = "#1d1d1d", underline = true, sp = "#2e2e2e" })

		require("nvim-treesitter.configs").setup({
			context = {
				enable = true, -- Enable this plugin (Can be enabled/disabled later via commands)
				throttle = true, -- Throttles plugin updates (may improve performance)
			},
		})
	end,
}
