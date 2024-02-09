return {
	"smoka7/multicursors.nvim",
	event = "VeryLazy",
	dependencies = {
		"smoka7/hydra.nvim",
	},
	opts = {},
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
    require("multicursors").setup({
      hint_config = {
        border = 'rounded'
      }
    })

    vim.api.nvim_set_hl(0, "MultiCursor", { fg = "#E5B769" })
    vim.api.nvim_set_hl(0, "MultiCursorMain", { bg = "#F4AC45", fg = "#252525" })
    -- hydra.nvim highlights
    vim.api.nvim_set_hl(0, "HydraPink", { fg = "#b279a7" })
    vim.api.nvim_set_hl(0, "HydraTeal", { fg = "#97bdde" })
    vim.api.nvim_set_hl(0, "HydraBlue", { fg = "#97bdde" })
    vim.api.nvim_set_hl(0, "HydraRed", { fg = "#DE6E7C" })

  end
}
