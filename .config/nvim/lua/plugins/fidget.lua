return {
	"j-hui/fidget.nvim",
	event = "BufWinEnter",
	config = function()
		require("fidget").setup({
			progress = {
				display = {
					done_icon = "",
					progress_icon = { pattern = "dots_scrolling" },
				},
			},
			notification = {
				filter = vim.log.levels.INFO,
			},
		})
	end,
}
