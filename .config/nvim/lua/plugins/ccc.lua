return {
	"uga-rosa/ccc.nvim",
	cmd = "CccPick",
	event = { "BufRead" },
	keys = {
		{
			mode = { "n" },
			"<leader>pc",
			"<cmd>CccPick<cr>",
			desc = "pick color",
		},
	},
	config = function()
		local ccc = require("ccc")
		ccc.setup({
			highlighter = {
				highlight_mode = "fg",
				auto_enable = true,
			},
		})
	end,
}
