return {
	"rmagatti/auto-session",
	dependencies = {
		{
			"stevearc/overseer.nvim",
			event = "VeryLazy",
		},
	},
	config = function()
		local cwd = vim.v.cwd or vim.fn.getcwd(0)
		local function get_cwd_as_name()
			return cwd:gsub("[^A-Za-z0-9]", "_")
		end
		local root_dir = vim.fn.expand("~/.config") .. "/.sessions/"
		local bundle = root_dir .. get_cwd_as_name()

		vim.api.nvim_create_user_command("WipeAllSessions", function()
			local cmd = string.format("rm -rf %s", root_dir)
			os.execute(cmd)
			vim.notify("Wiped all sessions", vim.log.levels.INFO, {
				title = "AutoSession",
			})
		end, { bang = true })

		require("auto-session").setup({
			auto_session_root_dir = root_dir,
			-- auto_session_use_git_branch = true,
			auto_restore_enabled = true,
			log_level = vim.log.levels.WARN,
			cwd_change_handling = {
				restore_upcoming_session = true,
			},
			pre_save_cmds = {
				function()
					local overseer = require("overseer")
					overseer.save_task_bundle(
						bundle,
						-- Passing nil will use config.opts.save_task_opts. You can call list_tasks() explicitly and
						-- pass in the results if you want to save specific tasks.
						nil,
						{ on_conflict = "overwrite" } -- Overwrite existing bundle, if any
					)
				end,
			},
			pre_restore_cmds = {
				function()
					local overseer = require("overseer")
					for _, task in ipairs(overseer.list_tasks({})) do
						task:dispose(true)
					end
					vim.defer_fn(function()
						overseer.preload_task_cache({ dir = cwd })
					end, 50)
				end,
			},
			post_restore_cmds = {
				function()
					vim.defer_fn(function()
						require("overseer").load_task_bundle(bundle, { ignore_missing = true })
					end, 100)
				end,
			},
		})
	end,
}
