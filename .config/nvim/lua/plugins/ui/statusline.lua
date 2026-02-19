return {
	"nvim-lualine/lualine.nvim",
	dependencies = {
		"nvim-tree/nvim-web-devicons",
	},
	event = "VeryLazy",
	config = function()
		local git = require("utils.git")
		local codexbar = require("utils.usage.codex")
		local copilot_usage = require("utils.usage.copilot")
		local opencode_zen_stats = require("utils.usage.opencode")
		local anthropic_usage = require("utils.usage.anthropic")

		local lualine_x = {
			require("opencode").statusline,
			{
				function()
					local ok, result = pcall(codexbar.statusline_component)
					if not ok then
						return nil
					end
					return result
				end,
			},
			{
				function()
					local ok, result = pcall(copilot_usage.statusline_component)
					if not ok then
						return nil
					end
					return result
				end,
			},
			{
				function()
					local ok, result = pcall(opencode_zen_stats.statusline_component)
					if not ok then
						return nil
					end
					return result
				end,
			},
			{
				function()
					local ok, result = pcall(anthropic_usage.statusline_component)
					if not ok then
						return nil
					end
					return result
				end,
			},
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
				function()
					-- Lazy-load git-blame only when needed
					local ok, git_blame = pcall(require, "gitblame")
					if ok then
						return git_blame.get_current_blame_text()
					end
					return ""
				end,
				cond = function()
					local ok, git_blame = pcall(require, "gitblame")
					return git.is_git_repo() and ok and git_blame.is_blame_text_available()
				end,
			},
		}

		require("lualine").setup({
			options = {
				theme = "zenwritten",
				section_separators = { left = "", right = "" },
				component_separators = { left = "", right = "" },
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
