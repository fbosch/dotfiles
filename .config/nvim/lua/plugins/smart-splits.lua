return {
	"mrjones2014/smart-splits.nvim",
	dependencies = "kwkarlwang/bufresize.nvim",
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
