return {
	{
		"pmizio/typescript-tools.nvim",
		ft = { "typescript", "typescriptreact", "javascript", "javascriptreact" },
		dependencies = { "nvim-lua/plenary.nvim", "neovim/nvim-lspconfig" },
		enabled = true,
		config = function()
			require("typescript-tools").setup({
				on_attach = on_attach,
				separate_diagnostic_server = false,
				publish_diagnostic_on = "insert_leave",
				complete_function_calls = false,
				jsx_close_tag = {
					enable = false,
					filetypes = { "javascriptreact", "typescriptreact" },
				},
			})
		end,
	},
}
