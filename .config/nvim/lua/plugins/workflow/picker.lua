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
		config = function()
			local ccc = require("ccc")
			ccc.setup({
				highlight_mode = "virtual",
				virtual_symbol = " ",
				virtual_pos = "inline-left",
				highlighter = {
					auto_enable = true,
					lsp = true,
					filetypes = { "css", "typescriptreact", "javascriptreact", "html", "lua", "ron", "xml" },
				},
			})
		end,
	},
	{
		"2kabhishek/nerdy.nvim",
		dependencies = {
			"folke/snacks.nvim",
			"nvim-telescope/telescope.nvim",
		},
		cmd = "Nerdy",
		config = function()
			require("telescope").load_extension("nerdy")
		end,
	},
}
