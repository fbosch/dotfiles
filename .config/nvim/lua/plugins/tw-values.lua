return {
	"MaximilianLloyd/tw-values.nvim",
	event = "LspAttach",
	ft = { "typescript", "typescriptreact", "javascript", "javascriptreact" },
	config = function()
		require("tw-values").setup()
		vim.keymap.set("n", "<leader>tw", "<CMD>TWValues<CR>", { noremap = true, silent = true })
	end,
}
