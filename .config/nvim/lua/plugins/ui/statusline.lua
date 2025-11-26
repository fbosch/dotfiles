return {
	"nvim-lualine/lualine.nvim",
	dependencies = {
		"nvim-tree/nvim-web-devicons",
		{
			"f-person/git-blame.nvim",
			event = "VeryLazy",
			-- Always load, let the statusline decide when to show it
		},
	},
	event = "BufWinEnter",
	config = function()
		local git = require("utils.git")
		local git_blame = require("gitblame")

		-- Configure git-blame
		vim.g.gitblame_display_virtual_text = 0 -- Disable virtual text
		vim.g.gitblame_date_format = "%r"
		vim.g.gitblame_message_template = " <author>   <date>   <sha> "

		local lualine_x = {
			require("opencode").statusline,
		}

		-- Make git components conditional on current buffer being in a git repo
		local lualine_b = {
			{
				"branch",
				cond = function()
					return git.is_git_repo()
				end,
			},
		}

		local lualine_c = {
			{
				git_blame.get_current_blame_text,
				cond = function()
					return git.is_git_repo() and git_blame.is_blame_text_available()
				end,
			},
		}

		require("lualine").setup({
			options = {
				theme = "zenwritten",
				-- section_separators = { left = "", right = "" },
				globalstatus = true,
				always_divide_middle = false,
			},
			extensions = { "symbols-outline" },
			sections = {
				lualine_b = lualine_b,
				lualine_c = lualine_c,
				lualine_x = lualine_x,
				lualine_y = {
					"filetype",
				},
			},
		})
	end,
}
