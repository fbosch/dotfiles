return {
	{
		"nvim-telescope/telescope.nvim",
		cmd = { "Telescope" },
		config = function()
			local telescope = require("telescope")
			telescope.setup({
				defaults = {
					layout_config = {
						width = 0.8,
						height = 0.8,
						scroll_speed = 1.5,
						preview_cutoff = 30,
					},
					mappings = {
						i = {
							["<C-j>"] = require("telescope.actions").move_selection_next,
							["<C-k>"] = require("telescope.actions").move_selection_previous,
						},
						n = {
							["<C-j>"] = require("telescope.actions").move_selection_next,
							["<C-k>"] = require("telescope.actions").move_selection_previous,
						},
					},
				},
			})
		end,
		keys = {
			{
				mode = "n",
				"<leader>?",
				"<cmd>Telescope help_tags<CR>",
				desc = "Telescope help tags",
			},
			{
				mode = "v",
				"<leader>?",
				function()
					vim.cmd('normal! ""y')
					local default_text = vim.fn.escape(vim.fn.getreg('"'), " ")
					require("telescope.builtin").help_tags({ default_text = default_text })
				end,
				desc = "Telescope help tags visual selection",
			},
		},
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
