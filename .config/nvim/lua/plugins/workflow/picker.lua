return {
	{
		"nvim-telescope/telescope.nvim",
		cmd = { "Telescope" },
		config = function()
			local telescope = require("telescope")
			telescope.setup({
				defaults = {
					layout_config = {
						width = 0.4,
						height = 0.4,
						scroll_speed = 1.5,
						preview_cutoff = 30,
					},
				},
			})
		end,
	},
	{
		"uga-rosa/ccc.nvim",
		ft = { "css", "typescriptreact", "javascriptreact", "html", "lua" },
		event = "BufRead",
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
