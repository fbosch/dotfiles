return {
	{
		"numtostr/FTerm.nvim",
		cmd = { "FTermOpen", "FTermClose", "FTermExit", "FTermToggle", "FtermMProcs", "FTermGitUI" },
		keys = {
			{
				"<A-t>",
				"<cmd>FTermToggle<cr>",
				desc = "toggle floating terminal",
				mode = "n",
				silent = true,
			},
			{
				"<A-t>",
				"<C-\\><C-n><cmd>FTermToggle<cr>",
				desc = "toggle floating terminal",
				mode = "t",
				silent = true,
			},
			{
				"<A-m>",
				"<cmd>FTermMProcs<cr>",
				desc = "toggle floating terminal with mprocs",
				mode = "n",
				silent = true,
			},
			{
				"<A-m>",
				"<C-\\><C-n><cmd>FTermMProcs<cr>",
				desc = "toggle floating terminal with mprocs",
				mode = "t",
				silent = true,
			},
			{
				"<A-g>",
				"<cmd>FTermGitUI<cr>",
				desc = "toggle floating terminal with gitui",
				mode = "n",
				silent = true,
			},
			{
				"<A-g>",
				"<C-\\><C-n><cmd>FTermGitUI<cr>",
				desc = "toggle floating terminal with gitui",
				mode = "t",
				silent = true,
			},
		},
		config = function()
			local usrcmd = vim.api.nvim_create_user_command
			local fterm = require("FTerm")
			local env = {
				["IN_NEOVIM"] = "1",
			}

			fterm.setup({
				border = "rounded",
				env = env,
				dimensions = {
					height = 0.85,
					width = 0.85,
				},
			})
			usrcmd("FTermOpen", fterm.open, { bang = true })
			usrcmd("FTermClose", fterm.close, { bang = true })
			usrcmd("FTermExit", fterm.exit, { bang = true })
			usrcmd("FTermToggle", fterm.toggle, { bang = true })

			local mprocs_instance = nil
			usrcmd("FTermMProcs", function()
				if not mprocs_instance then
					local args = require("utils.project").resolve_mprocs_args()
					mprocs_instance = fterm:new({
						ft = "fterm_mprocs",
						env = env,
						shell = "dash",
						cmd = string.format("mprocs %s", args),
						dimensions = {
							height = 0.65,
							width = 0.65,
						},
					})
				end
				mprocs_instance:toggle()
			end, { bang = true })

			local gitui_instance = nil
			usrcmd("FTermGitUI", function()
				if not gitui_instance then
					gitui_instance = fterm:new({
						ft = "fterm_gitui",
						env = env,
						cmd = "gitui",
						dimensions = {
							height = 0.65,
							width = 0.65,
						},
					})
				end
				gitui_instance:toggle()
			end, { bang = true })
		end,
	},
	{
		"akinsho/toggleterm.nvim",
		event = "VeryLazy",
		opts = {
			size = 20,
			open_mapping = [[<c-\>]],
			close_mapping = [[<c-\>]],
			hide_numbers = true,
			shade_filetypes = {},
			shade_terminals = true,
			shading_factor = 1,
			start_in_insert = true,
			persist_size = true,
			direction = "horizontal",
			close_on_exit = true,
			shell = vim.o.shell,
		},
	},
}
