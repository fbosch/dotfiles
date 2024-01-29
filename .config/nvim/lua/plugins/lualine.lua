return {
	"nvim-lualine/lualine.nvim",
	priority = 100,
	dependencies = {
		"kyazdani42/nvim-web-devicons",
		"f-person/git-blame.nvim",
	},
	event = { "BufRead", "LspAttach" },
	config = function()
		local overseer = require("overseer")
		local git_blame = require("gitblame")
		vim.g.gitblame_display_virtual_text = 0 -- Disable virtual text
		vim.g.gitblame_date_format = "%r"
		vim.g.gitblame_message_template = " <author>  﨟<date>"
		require("lualine").setup({
			options = {
				theme = "auto",
				globalstatus = true,
			},
			extensions = { "fugitive", "symbols-outline" },
			sections = {
				lualine_b = {
					{
						"overseer",
						label = "", -- Prefix for task counts
						colored = true, -- Color the task icons and counts
						symbols = {
							[overseer.STATUS.FAILURE] = "󰚌 ",
							[overseer.STATUS.CANCELED] = "󰜺 ",
							[overseer.STATUS.SUCCESS] = "󱤶 ",
							[overseer.STATUS.RUNNING] = "󱑠 ",
						},
						unique = false, -- Unique-ify non-running task count by name
						name_not = false, -- When true, invert the name search
						status = nil, -- List of task statuses to display
						status_not = false, -- When true, invert the status search
					},
				},
				lualine_c = { require("auto-session.session-lens.library").current_session_name },
				lualine_x = {
					{ git_blame.get_current_blame_text, cond = git_blame.is_blame_text_available },
				},
				lualine_y = {
					"filetype",
				},
				lualine_z = {
					"os.date('%H:%M')",
				},
			},
		})
	end,
}
