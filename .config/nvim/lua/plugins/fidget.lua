return {
	"j-hui/fidget.nvim",
	event = "LspAttach",
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
				override_vim_notify = true,
			},
			integration = {
				["nvim-tree"] = {
					enable = true,
				},
			},
		})
	end,
}
