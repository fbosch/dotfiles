return {
	"dmmulroy/tsc.nvim",
	cmd = "TSC",
	ft = { "typescript", "typescriptreact" },
	keys = {
		{
			mode = "n",
			"<leader>ts",
			"<cmd>TSC<cr>",
			desc = "Run typescript validation in current buffer",
		},
	},
	config = function()
		require("tsc").setup({
			spinner = {
				".  ",
				".. ",
				"...",
				" ..",
				"  .",
				"   ",
			},
			pretty_errors = true,
		})
	end,
}
