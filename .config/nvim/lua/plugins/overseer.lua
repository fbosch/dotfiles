return {
	"stevearc/overseer.nvim",
	dependencies = {
		"stevearc/dressing.nvim",
	},
	event = "VeryLazy",
	cmd = { "OverseerToggle", "OverseerRun", "OverseerLoadBundle" },
	priority = 70,
	keys = {
		{
			mode = { "n" },
			"<leader>ot",
			"<cmd>OverseerToggle<cr>",
			desc = "Toggle the task list",
		},
		{
			mode = { "n" },
			"<leader>or",
			"<cmd>OverseerRun<cr>",
			desc = "Run the selected task",
		},
		{
			mode = { "n" },
			"<leader>od",
			"<cmd>OverseerLoadBundle dev<cr>",
			desc = "Load the dev bundle",
		},
	},
	config = function()
		vim.defer_fn(function()
			require("overseer").setup({
				strategy = {
					"toggleterm",
					-- load your default shell before starting the task
					use_shell = false,
					-- overwrite the default toggleterm "direction" parameter
					direction = nil,
					-- overwrite the default toggleterm "highlights" parameter
					highlights = nil,
					-- overwrite the default toggleterm "auto_scroll" parameter
					auto_scroll = nil,
					-- have the toggleterm window close and delete the terminal buffer
					-- automatically after the task exits
					close_on_exit = true,
					-- have the toggleterm window close without deleting the terminal buffer
					-- automatically after the task exits
					-- can be "never, "success", or "always". "success" will close the window
					-- only if the exit code is 0.
					quit_on_exit = "always",
					-- open the toggleterm window when a task starts
					open_on_start = false,
					-- mirrors the toggleterm "hidden" parameter, and keeps the task from
					-- being rendered in the toggleable window
					hidden = true,
					-- command to run when the terminal is created. Combine with `use_shell`
					-- to run a terminal command before starting the task
					on_create = nil,
				},
				task_win = {
					border = "rounded",
					winblend = 10,
				},
				task_list = {
					default_detail = 1,
					max_width = { 30, 0.2 },
				},
				form = {
					border = "rounded",
					zindex = 40,
					-- Dimensions can be integers or a float between 0 and 1 (e.g. 0.4 for 40%)
					-- min_X and max_X can be a single value or a list of mixed integer/float types.
					min_width = 40,
					max_width = 0.9,
					width = nil,
					min_height = 10,
					max_height = 0.9,
					height = nil,
					-- Set any window options here (e.g. winhighlight)
					win_opts = {
						winblend = 10,
					},
				},
			})
		end, 100)
	end,
}
