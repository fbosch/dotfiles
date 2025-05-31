local is_git_repo = require("utils.git").is_git_repo()

return {
	"nvim-lualine/lualine.nvim",
	dependencies = {
		"nvim-tree/nvim-web-devicons",
		{
			"f-person/git-blame.nvim",
			cond = is_git_repo,
		},
	},
	event = "BufWinEnter",
	config = function()
		local lualine_x = {}
		local lualine_c = {}

		if is_git_repo then
			local git_blame = require("gitblame")
			vim.g.gitblame_display_virtual_text = 0 -- Disable virtual text
			vim.g.gitblame_date_format = "%r"
			vim.g.gitblame_message_template = " <author>   <date>   <sha> "
			lualine_c = {
				"branch",
			}
			lualine_x = {
				{
					git_blame.get_current_blame_text,
					cond = git_blame.is_blame_text_available,
				},
			}
		end

		require("lualine").setup({
			options = {
				theme = "auto",
				section_separators = { left = "", right = "" },
				globalstatus = true,
				always_divide_middle = false,
			},
			extensions = { "symbols-outline" },
			sections = {
				lualine_b = {},
				lualine_c = lualine_c,
				lualine_x = lualine_x,
				lualine_y = {
					"filetype",
				},
			},
		})
	end,
}
