return {
	{
		"uga-rosa/ccc.nvim",
		enabled = true,
		event = { "VeryLazy", "BufEnter" },
		keys = {
			{
				mode = "n",
				"<leader>pc",
				"<cmd>CccPick<cr>",
				desc = "pick color",
				silent = true,
			},
		},
		config = function()
			local ccc = require("ccc")
			ccc.setup({
				highlighter = {
					highlight_mode = "fg",
					auto_enable = true,
					lsp = true,
				},
			})
		end,
	},
}
