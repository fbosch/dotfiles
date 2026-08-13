local function is_git_repo(context)
	local bufnr = type(context) == "table" and context.buf or nil
	return require("utils.git").is_git_repo(bufnr)
end

local register = require("config.pack.registry").register

local gitsigns_options = {
	current_line_blame = true,
	current_line_blame_opts = {
		virt_text = false,
		delay = 100,
	},
	current_line_blame_formatter = " <author>   <author_time:%R>   <abbrev_sha> ",
	signs = {
		add = { text = "+▕" },
		change = { text = "~▕" },
		delete = { text = "-▕" },
		topdelete = { text = "‾" },
		changedelete = { text = "~" },
	},
	preview_config = {
		border = "rounded",
		style = "minimal",
		relative = "cursor",
		col = 3,
		row = -3,
	},
}

local function with_gitsigns(action)
	local bufnr = vim.api.nvim_get_current_buf()
	local gitsigns = require("gitsigns")
	if require("gitsigns.cache").cache[bufnr] == nil then
		gitsigns.attach({ bufnr = bufnr, trigger = "key" })
	end

	local attached = vim.wait(2000, function()
		local cache = require("gitsigns.cache").cache[bufnr]
		return cache ~= nil and cache.hunks ~= nil
	end, 10)
	if attached == false or vim.api.nvim_get_current_buf() ~= bufnr then
		vim.notify("Gitsigns could not attach to the current buffer", vim.log.levels.WARN)
		return
	end

	action(gitsigns)
end

local function refresh_git_conflicts(bufnr)
	vim.api.nvim_buf_call(bufnr, function()
		vim.cmd("GitConflictRefresh")
	end)
end

local function with_git_conflict(action)
	local bufnr = vim.api.nvim_get_current_buf()
	local conflict = require("git-conflict")
	local ok, count = pcall(conflict.conflict_count, bufnr)
	if ok and count > 0 then
		action(conflict)
		return
	end

	local finished = false
	local id = vim.api.nvim_create_autocmd("User", {
		pattern = "GitConflictDetected",
		callback = function()
			if vim.api.nvim_get_current_buf() ~= bufnr then
				return
			end

			finished = true
			action(conflict)
			return true
		end,
	})
	refresh_git_conflicts(bufnr)
	vim.defer_fn(function()
		if finished then
			return
		end

		pcall(vim.api.nvim_del_autocmd, id)
		vim.notify("No Git conflict is available in the current buffer", vim.log.levels.WARN)
	end, 2000)
end

local function list_git_conflicts()
	local bufnr = vim.api.nvim_get_current_buf()
	local conflict = require("git-conflict")
	refresh_git_conflicts(bufnr)

	local discovered = vim.wait(2000, function()
		local count = 0
		conflict.conflicts_to_qf_items(function(items)
			count = #items
		end)
		return count > 0
	end, 10)
	if discovered == false then
		vim.notify("No Git conflicts are available in this repository", vim.log.levels.WARN)
		return
	end

	vim.cmd("GitConflictListQf")
end

register({
	{
		name = "diffview.nvim",
		src = "https://github.com/sindrets/diffview.nvim.git",
		dependencies = { "plenary.nvim" },
		condition = is_git_repo,
		commands = { "DiffviewOpen", "DiffviewClose" },
		keys = {
			{
				"<leader>dff",
				function()
					vim.cmd("DiffviewOpen")
				end,
				mode = "n",
				desc = "diff view open",
			},
			{
				"<leader>dfq",
				function()
					vim.cmd("DiffviewClose")
				end,
				mode = "n",
				desc = "diff view close",
			},
		},
	},
	{
		name = "gitlineage.nvim",
		src = "https://github.com/lionyxml/gitlineage.nvim.git",
		dependencies = { "diffview.nvim" },
		condition = is_git_repo,
		module = "gitlineage",
		keys = {
			{
				"<leader>gl",
				function()
					require("gitlineage").show_history()
				end,
				mode = "v",
				desc = "git line history",
			},
		},
		opts = {
			keymap = "<leader>gl",
		},
	},
	{
		name = "git-conflict.nvim",
		src = "https://github.com/akinsho/git-conflict.nvim.git",
		condition = is_git_repo,
		events = { "BufReadPost" },
		keys = {
			{
				"<leader>gco",
				function()
					with_git_conflict(function(conflict)
						conflict.choose("ours")
					end)
				end,
				mode = { "n" },
				desc = "git conflict choose ours",
				silent = true,
			},
			{
				"<leader>gct",
				function()
					with_git_conflict(function(conflict)
						conflict.choose("theirs")
					end)
				end,
				mode = { "n" },
				desc = "git conflict choose theirs",
				silent = true,
			},
			{
				"<leader>gcb",
				function()
					with_git_conflict(function(conflict)
						conflict.choose("both")
					end)
				end,
				mode = { "n" },
				desc = "git conflict choose both",
				silent = true,
			},
			{
				"<leader>gc0",
				function()
					with_git_conflict(function(conflict)
						conflict.choose("none")
					end)
				end,
				mode = { "n" },
				desc = "git conflict choose none",
				silent = true,
			},
			{
				"<leader>gcn",
				function()
					with_git_conflict(function(conflict)
						conflict.find_next("ours")
					end)
				end,
				mode = { "n" },
				desc = "git conflict next",
				silent = true,
			},
			{
				"<leader>gcp",
				function()
					with_git_conflict(function(conflict)
						conflict.find_prev("ours")
					end)
				end,
				mode = { "n" },
				desc = "git conflict previous",
				silent = true,
			},
			{
				"<leader>gcl",
				list_git_conflicts,
				mode = { "n" },
				desc = "git conflict list in quickfix",
				silent = true,
			},
		},
		setup = function(context)
			require("git-conflict").setup({
				default_mappings = {
					ours = "co", -- choose current (ours)
					theirs = "ct", -- choose incoming (theirs)
					both = "cb", -- choose both changes
					none = "c0", -- choose none (delete conflict)
					prev = "[x", -- go to previous conflict
					next = "]x", -- go to next conflict
				},
				highlights = {
					incoming = "DiffAdd",
					current = "DiffDelete",
				},
			})

			local refresh_group = vim.api.nvim_create_augroup("NativeGitConflictRefresh", { clear = true })
			vim.api.nvim_create_autocmd({ "BufEnter", "BufReadPost", "BufWritePost", "FocusGained" }, {
				group = refresh_group,
				callback = function(event)
					if is_git_repo(event) then
						refresh_git_conflicts(event.buf)
					end
				end,
			})

			local bufnr = context.buf or vim.api.nvim_get_current_buf()
			if vim.api.nvim_buf_is_valid(bufnr) and vim.api.nvim_buf_get_name(bufnr) ~= "" then
				refresh_git_conflicts(bufnr)
			end
		end,
	},
	{
		name = "gitsigns.nvim",
		src = "https://github.com/lewis6991/gitsigns.nvim.git",
		condition = is_git_repo,
		events = { "BufReadPost", "BufNewFile", "BufWritePost" },
		module = "gitsigns",
		keys = {
			{
				"<leader>gs",
				function()
					with_gitsigns(function(gitsigns)
						gitsigns.stage_buffer()
					end)
				end,
				mode = { "n" },
				desc = "git stage buffer",
				silent = true,
			},
			{
				"<leader>grb",
				function()
					with_gitsigns(function(gitsigns)
						gitsigns.reset_buffer()
					end)
				end,
				mode = { "n" },
				desc = "git reset buffer",
				silent = true,
			},
			{
				"<leader>grh",
				function()
					with_gitsigns(function(gitsigns)
						gitsigns.reset_hunk()
					end)
				end,
				mode = { "n" },
				desc = "git reset hunk",
				silent = true,
			},
			{
				"<leader>gn",
				function()
					local count = vim.v.count1
					with_gitsigns(function(gitsigns)
						gitsigns.nav_hunk("next", { count = count })
					end)
				end,
				mode = { "n" },
				desc = "git next hunk",
				silent = true,
			},
			{
				"<leader>gN",
				function()
					local count = vim.v.count1
					with_gitsigns(function(gitsigns)
						gitsigns.nav_hunk("prev", { count = count })
					end)
				end,
				mode = { "n" },
				desc = "git previous hunk",
				silent = true,
			},
			{
				"<leader>gb",
				function()
					with_gitsigns(function(gitsigns)
						gitsigns.blame_line()
					end)
				end,
				mode = { "n" },
				desc = "git blame line",
				silent = true,
			},
			{
				"<leader>gB",
				function()
					with_gitsigns(function(gitsigns)
						gitsigns.blame()
					end)
				end,
				mode = { "n" },
				desc = "git blame",
				silent = true,
			},
			{
				"<leader>gh",
				function()
					with_gitsigns(function(gitsigns)
						gitsigns.select_hunk()
					end)
				end,
				mode = { "n", "v" },
				desc = "git select hunk",
				silent = true,
			},
		},
		setup = function(context)
			local gitsigns = require("gitsigns")
			gitsigns.setup(gitsigns_options)

			local bufnr = context.buf or vim.api.nvim_get_current_buf()
			if vim.api.nvim_buf_is_valid(bufnr) and vim.api.nvim_buf_get_name(bufnr) ~= "" then
				gitsigns.attach({ bufnr = bufnr, trigger = "native" })
			end
		end,
	},
})

return {}
