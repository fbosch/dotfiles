return {
	"nvim-lualine/lualine.nvim",
	dependencies = {
		"nvim-tree/nvim-web-devicons",
	},
	event = "VeryLazy",
	config = function()
		local git = require("utils.git")
		local codexbar = require("utils.usage.codex")
		require("utils.usage.opencode")
		-- local anthropic_usage = require("utils.usage.anthropic")

		local function is_valid_status(result)
			return type(result) == "string"
				and result ~= ""
				and result:match("^%s*$") == nil
				and result:match("%f[%a]unknown%f[%A]") == nil
		end

		local lualine_x = {
			{
				function()
					local opencode = package.loaded.opencode
					local ok, result = pcall(opencode and opencode.statusline or function()
						return ""
					end)
					if not ok or not is_valid_status(result) then
						return ""
					end
					return result
				end,
				cond = function()
					local opencode = package.loaded.opencode
					local ok, result = pcall(opencode and opencode.statusline or function()
						return ""
					end)
					return ok and is_valid_status(result)
				end,
			},
			{
				function()
					local ok, result = pcall(codexbar.statusline_component)
					if not ok or not is_valid_status(result) then
						return ""
					end
					return result
				end,
				cond = function()
					local ok, result = pcall(codexbar.statusline_component)
					return ok and is_valid_status(result)
				end,
			},
			-- {
			-- 	function()
			-- 		local _, result = pcall(anthropic_usage.statusline_component)
			-- 		return result .. " %#Comment#│%*"
			-- 	end,
			-- 	cond = function()
			-- 		local ok, result = pcall(anthropic_usage.statusline_component)
			-- 		return ok and result ~= nil and result ~= ""
			-- 	end,
			-- },
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
					return vim.b.gitsigns_blame_line or vim.b.last_gitsigns_blame_line or ""
				end,
				cond = function()
					return git.is_git_repo()
						and (is_valid_status(vim.b.gitsigns_blame_line) or is_valid_status(vim.b.last_gitsigns_blame_line))
				end,
			},
		}

		local blame_refresh_id = 0
		vim.api.nvim_create_autocmd({ "BufEnter", "CursorMoved" }, {
			group = vim.api.nvim_create_augroup("LualineGitsignsBlame", { clear = true }),
			callback = function()
				if is_valid_status(vim.b.gitsigns_blame_line) then
					vim.b.last_gitsigns_blame_line = vim.b.gitsigns_blame_line
				end

				blame_refresh_id = blame_refresh_id + 1
				local current_refresh_id = blame_refresh_id
				vim.defer_fn(function()
					if is_valid_status(vim.b.gitsigns_blame_line) then
						vim.b.last_gitsigns_blame_line = vim.b.gitsigns_blame_line
					end

					if current_refresh_id == blame_refresh_id then
						pcall(require("lualine").refresh, { place = { "statusline" } })
					end
				end, 100)
			end,
		})

		require("lualine").setup({
			options = {
				theme = "zenwritten",
				section_separators = { left = "", right = "" },
				component_separators = { left = "", right = "" },
				globalstatus = true,
				always_divide_middle = false,
			},
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
