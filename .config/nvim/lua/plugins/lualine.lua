return {
	"nvim-lualine/lualine.nvim",
	dependencies = {
		"kyazdani42/nvim-web-devicons",
		"f-person/git-blame.nvim",
	},
	event = { "BufRead", "LspAttach", "ColorScheme" },
	priority = 50,
	config = function()
		local overseer = require("overseer")
		local git_blame = require("gitblame")
		vim.g.gitblame_display_virtual_text = 0 -- Disable virtual text
		vim.g.gitblame_date_format = "%r"
		vim.g.gitblame_message_template = " <author>   <date>   <sha> "
		require("lualine").setup({
			options = {
				theme = "auto",
				-- section_separators = { left = "", right = "" },
				section_separators = { left = "", right = "" },
				globalstatus = true,
				always_divide_middle = false,
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
							[overseer.STATUS.CANCELED] = " ",
							[overseer.STATUS.SUCCESS] = " ",
							[overseer.STATUS.RUNNING] = " ",
						},
						unique = true, -- Unique-ify non-running task count by name
						name_not = false, -- When true, invert the name search
						status = nil, -- List of task statuses to display
						status_not = false, -- When true, invert the status search
					},
				},
				lualine_c = {
					"branch",
				},
				lualine_x = {
					{
						git_blame.get_current_blame_text,
						cond = git_blame.is_blame_text_available,
					},
				},
				lualine_y = {
					"filetype",
				},
				-- lualine_z = {
				-- 	function()
				-- 		local current_hour = tonumber(os.date("%I"))
				-- 		local current_time = os.date("%H:%M")
				-- 		local icon_tbl = {
				-- 			[1] = "󱐿",
				-- 			[2] = "󱑀",
				-- 			[3] = "󱑁",
				-- 			[4] = "󱑂",
				-- 			[5] = "󱑃",
				-- 			[6] = "󱑄",
				-- 			[7] = "󱑅",
				-- 			[8] = "󱑆",
				-- 			[9] = "󱑇",
				-- 			[10] = "󱑈",
				-- 			[11] = "󱑉",
				-- 			[12] = "󱑊",
				-- 		}
				-- 		local icon = icon_tbl[current_hour]
				-- 		return icon .. " " .. current_time
				-- 	end,
				-- },
			},
		})
	end,
}
