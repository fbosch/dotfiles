return {
	"rcarriga/nvim-notify",
	config = function()
		require("notify").setup({
			border = "rounded",
			stages = "fade",
			fps = 60,
			max_width = 60,
			top_down = true,
		})

		vim.notify = require("notify")
	end,
}
