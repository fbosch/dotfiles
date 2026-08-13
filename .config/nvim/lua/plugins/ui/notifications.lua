require("config.pack.registry").register({
	{
		name = "nvim-notify",
		src = "https://github.com/rcarriga/nvim-notify.git",
		root = false,
	},
	{
		name = "nvim-recorder",
		src = "https://github.com/chrisgrieser/nvim-recorder.git",
		dependencies = { "nvim-notify" },
		module = "recorder",
		opts = {},
	},
	{
		name = "fidget.nvim",
		src = "https://github.com/j-hui/fidget.nvim.git",
		dependencies = { "nvim-notify" },
		module = "fidget",
		opts = {
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
				integration = {
					["nvim-tree"] = {
						enable = true,
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
				window = {
					avoid = { "NvimTree" },
				},
			},
		},
	},
})

return {}
