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
				configs = {
					default = {
						name = "Notifications",
						icon = "󰂚",
						icon_style = "Special",
						annote_style = "Question",
						debug_style = "Comment",
						info_style = "Question",
						warn_style = "WarningMsg",
						error_style = "ErrorMsg",
						error_annote = " ",
						warn_annote = " ",
						info_annote = " ",
						debug_annote = " ",
					},
				},
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
