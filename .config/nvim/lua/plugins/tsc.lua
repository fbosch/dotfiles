return {
	"dmmulroy/tsc.nvim",
	event = "VeryLazy",
	ft = { "typescript", "typescriptreact" },
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
		})
	end,
}
