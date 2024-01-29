return {
	"mrjones2014/smart-splits.nvim",
	dependencies = "kwkarlwang/bufresize.nvim",
	event = { "WinResized" },
	cmd = { "SmartResizeUp", "SmartResizeDown", "SmartResizeLeft", "SmartResizeRight" },
	config = function()
		require("smart-splits").setup({
			resize_mode = {
				hooks = {
					on_leave = require("bufresize").register,
				},
			},
		})
	end,
}
