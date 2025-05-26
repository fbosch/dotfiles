return {
	{
		"chrisgrieser/nvim-recorder",
		dependencies = "rcarriga/nvim-notify",
		event = "VeryLazy",
		opts = {}, -- required even with default settings, since it calls `setup()`
	},
	{
		"j-hui/fidget.nvim",
		dependencies = "rcarriga/nvim-notify",
		event = "VeryLazy",
		config = function()
			require("fidget").setup({
				progress = {
					display = {
						done_icon = "",
						progress_icon = { pattern = "dots_scrolling" },
					},
					-- How to get a progress message's notification group key
					notification_group = function(msg)
						return msg.lsp_client.name
					end,
				},
				notification = {
					configs = {
						default = {
							name = "",
							icon = "",
							icon_style = "Special",
							annote_style = "DiagnosticInfo",
							debug_style = "Comment",
							info_style = "DiagnosticInfo",
							warn_style = "WarningMsg",
							error_style = "ErrorMsg",
							error_annote = "",
							warn_annote = "",
							info_annote = "",
							debug_annote = "",
						},
					},
					filter = vim.log.levels.INFO,
					override_vim_notify = true,
					redirect = function(msg, level, opts)
						-- HACK: to prevent LSPSaga from showing useless notifications
						if msg == "No information available" then
							return function() end
						end
						if opts and opts.on_open then
							return require("fidget.integration.nvim-notify").delegate(msg, level, opts)
						end
					end,
				},
				integration = {
					["nvim-tree"] = {
						enable = true,
					},
				},
			})
		end,
	},
}
