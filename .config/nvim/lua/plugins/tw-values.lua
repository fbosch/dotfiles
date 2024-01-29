return {
	"MaximilianLloyd/tw-values.nvim",
	cmd = "TWValues",
	ft = { "typescript", "typescriptreact", "javascript", "javascriptreact" },
	config = function()
		require("tw-values").setup()
	end,
}
