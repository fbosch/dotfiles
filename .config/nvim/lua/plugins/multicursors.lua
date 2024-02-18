return {
	"smoka7/multicursors.nvim",
	event = "VeryLazy",
	dependencies = {
		"smoka7/hydra.nvim",
	},
	opts = {},
	enabled = false,
	cmd = { "MCstart", "MCvisual", "MCclear", "MCpattern", "MCvisualPattern", "MCunderCursor" },
	keys = {
		{
			mode = { "v", "n" },
			"<Leader>m",
			"<cmd>MCstart<cr>",
			desc = "Create a selection for selected text or word under the cursor",
		},
	},
	config = function()
		local colors = require("colors")
		require("multicursors").setup({
			hint_config = {
				border = "rounded",
			},
		})

		vim.api.nvim_set_hl(0, "MultiCursor", { fg = colors.yellow })
		vim.api.nvim_set_hl(0, "MultiCursorMain", { bg = colors.yellow, fg = colors.darker_gray })
		-- hydra.nvim highlights
		vim.api.nvim_set_hl(0, "HydraPink", { fg = colors.purple })
		vim.api.nvim_set_hl(0, "HydraTeal", { fg = colors.blue })
		vim.api.nvim_set_hl(0, "HydraBlue", { fg = colors.blue })
		vim.api.nvim_set_hl(0, "HydraRed", { fg = colors.red })
	end,
}
