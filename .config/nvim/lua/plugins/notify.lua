return {
	"rcarriga/nvim-notify",
	event = "VeryLazy",
	enabled = false,
	config = function()
		require("notify").setup({
			border = "rounded",
			render = "wrapped-compact",
			fps = 60,
			max_width = 50,
			top_down = true,
		})
		vim.notify = require("notify")
	end,
}
