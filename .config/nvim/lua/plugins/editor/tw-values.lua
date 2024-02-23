return {
	"MaximilianLloyd/tw-values.nvim",
	cmd = "TWValues",
	ft = { "typescript", "typescriptreact", "javascript", "javascriptreact" },
	keys = {
		{
			mode = "n",
			"<leader>tw",
			"<cmd>TWValues<cr>",
			desc = "tailwind values",
		},
	},
}
