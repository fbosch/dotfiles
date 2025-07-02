return {
	{
		"uga-rosa/ccc.nvim",
		event = "VeryLazy",
		keys = {
			{
				mode = "n",
				"<leader>pc",
				"<cmd>CccPick<cr>",
				desc = "pick color",
				silent = true,
			},
		},
		opts = {
			highlight_mode = "virtual",
			virtual_symbol = " ",
			virtual_pos = "inline-left",
			highlighter = {
				auto_enable = true,
				lsp = true,
				filetypes = { "css", "typescriptreact", "javascriptreact", "html", "lua", "ron", "xml" },
			},
		},
	},
}
