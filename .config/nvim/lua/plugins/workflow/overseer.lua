return {
	"stevearc/overseer.nvim",
	dependencies = {
		"stevearc/dressing.nvim",
	},
	cmd = { "OverseerToggle", "OverseerRun", "OverseerLoadBundle" },
	priority = 70,
	keys = {
		{
			"<leader>ot",
			"<cmd>OverseerToggle<cr>",
			desc = "Toggle the task list",
			mode = { "n" },
			silent = true,
		},
		{
			"<leader>or",
			"<cmd>OverseerRun<cr>",
			desc = "Run the selected task",
			mode = { "n" },
			silent = true,
		},
		{
			"<leader>od",
			"<cmd>OverseerLoadBundle dev<cr>",
			desc = "Load the dev bundle",
			mode = { "n" },
			silent = true,
		},
	},
	opts = {
		strategy = {
			"toggleterm",
			use_shell = false,
			direction = nil,
			highlights = nil,
			auto_scroll = nil,
			close_on_exit = true,
			quit_on_exit = "always",
			open_on_start = false,
			hidden = true,
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
	},
}
