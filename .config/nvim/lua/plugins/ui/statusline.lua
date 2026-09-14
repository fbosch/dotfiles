return {
	name = "lualine.nvim",
	src = "https://github.com/nvim-lualine/lualine.nvim.git",
	dependencies = { "nvim-web-devicons" },
	setup = function()
		local git = require("utils.git")
		local repo_cache = {}
		local repo_group = vim.api.nvim_create_augroup("LualineGitRepo", { clear = true })

		-- Keep discovery off redraws without caching retryable Git plugin conditions.
		local function is_git_repo()
			local bufnr = vim.api.nvim_get_current_buf()
			if repo_cache[bufnr] == nil then
				repo_cache[bufnr] = git.is_git_repo(bufnr)
			end
			return repo_cache[bufnr]
		end

		vim.api.nvim_create_autocmd({ "BufEnter", "WinEnter", "BufFilePost", "BufWritePost", "BufWipeout" }, {
			group = repo_group,
			callback = function(event)
				repo_cache[event.buf] = nil
			end,
		})
		local function invalidate_repos()
			repo_cache = {}
		end
		-- Recheck external repo/symlink changes at interaction boundaries, not on edits.
		vim.api.nvim_create_autocmd({ "DirChanged", "FocusGained", "ShellCmdPost", "TermClose" }, {
			group = repo_group,
			callback = invalidate_repos,
		})
		-- Async integrations can explicitly report repo creation/removal without polling.
		vim.api.nvim_create_autocmd("User", {
			group = repo_group,
			pattern = { "FugitiveChanged", "StatuslineGitChanged" },
			callback = invalidate_repos,
		})

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
		}

		-- Make git components conditional on current buffer being in a git repo
		local lualine_b = {
			{
				"branch",
				cond = function()
					return is_git_repo()
				end,
			},
		}

		local lualine_c = {
			{
				function()
					return vim.b.gitsigns_blame_line or vim.b.last_gitsigns_blame_line or ""
				end,
				cond = function()
					return is_git_repo()
						and (
							is_valid_status(vim.b.gitsigns_blame_line)
							or is_valid_status(vim.b.last_gitsigns_blame_line)
						)
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
