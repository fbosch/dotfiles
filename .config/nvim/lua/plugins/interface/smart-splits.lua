return {
	"mrjones2014/smart-splits.nvim",
	dependencies = "kwkarlwang/bufresize.nvim",
	event = "VeryLazy",
	keys = {
		{
			mode = { "n" },
			"<C-Left>",
			"<cmd>SmartResizeLeft<cr>",
			desc = "resize left",
		},
		{
			mode = { "n" },
			"<C-Right>",
			"<cmd>SmartResizeRight<cr>",
			desc = "resize right",
		},
		{
			mode = { "n" },
			"<C-Up>",
			"<cmd>SmartResizeUp<cr>",
			desc = "resize up",
		},
		{
			mode = { "n" },
			"<C-Down>",
			"<cmd>SmartResizeDown<cr>",
			desc = "resize down",
		},
	},
	config = function()
		local bufresize = require("bufresize")
		bufresize.setup()
		require("smart-splits").setup({
			resize_mode = {
				hooks = {
					on_leave = bufresize.register,
				},
			},
		})
	end,
}
