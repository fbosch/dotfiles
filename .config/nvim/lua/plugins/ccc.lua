return {
	"uga-rosa/ccc.nvim",
	cmd = "CccPick",
	event = { "BufRead" },
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
