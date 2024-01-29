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
			pretty_errors = true,
		})
		vim.api.nvim_set_keymap("n", "<leader>ts", ":TSC<CR>", { noremap = true, silent = true })
	end,
}
