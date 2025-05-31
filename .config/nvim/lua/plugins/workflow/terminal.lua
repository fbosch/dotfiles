return {
	{
		"numtostr/FTerm.nvim",
		cmd = { "FTermOpen", "FTermClose", "FTermExit", "FTermToggle", "FtermMProcs" },
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
		},
		config = function()
			local usrcmd = vim.api.nvim_create_user_command
			local fterm = require("FTerm")
			fterm.setup({
				border = "rounded",
				env = {
					["IN_NEOVIM"] = "1",
				},
				dimensions = {
					height = 0.85,
					width = 0.85,
				},
			})

			local project_types = require("utils.project").get_project_types()
			local yaml_config = require("utils.fn").classify(project_types, {
				{
					{ "typescript", "javascript", "react" },
					"--npm",
				},
			})

			local mprocs = fterm:new({
				ft = "fterm_mprocs",
				cmd = string.format("mprocs %s", yaml_config or ""),
				dimensions = {
					height = 0.65,
					width = 0.75,
				},
			})

			usrcmd("FTermOpen", fterm.open, { bang = true })
			usrcmd("FTermClose", fterm.close, { bang = true })
			usrcmd("FTermExit", fterm.exit, { bang = true })
			usrcmd("FTermToggle", fterm.toggle, { bang = true })

			usrcmd("FTermMProcs", function()
				print(mprocs_yaml)
				mprocs:toggle()
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
