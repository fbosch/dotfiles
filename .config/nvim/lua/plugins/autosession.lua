local function get_cwd_as_name()
	local dir = vim.fn.getcwd(0)
	return dir:gsub("[^A-Za-z0-9]", "_")
end

return {
	"rmagatti/auto-session",
	dependencies = {
		"stevearc/overseer.nvim",
	},
	config = function()
		local overseer = require("overseer")
		require("auto-session").setup({
			auto_session_root_dir = vim.fn.expand("~/.config") .. "/nvim/.sessions//",
			-- auto_session_use_git_branch = true,
			auto_restore_enabled = true,
			log_level = vim.log.levels.WARN,
			cwd_change_handling = {
				restore_upcoming_session = true,
				post_cwd_changed_hook = function()
					vim.cmd(":VimadeRedraw")
					vim.cmd(":syntax on")
				end,
			},
			pre_save_cmds = {
				function()
					overseer.save_task_bundle(
						get_cwd_as_name(),
						-- Passing nil will use config.opts.save_task_opts. You can call list_tasks() explicitly and
						-- pass in the results if you want to save specific tasks.
						nil,
						{ on_conflict = "overwrite" } -- Overwrite existing bundle, if any
					)
				end,
			},
			pre_restore_cmds = {
				function()
					for _, task in ipairs(overseer.list_tasks({})) do
						task:dispose(true)
					end
				end,
			},
			post_restore_cmds = {
				function()
					overseer.load_task_bundle(get_cwd_as_name(), { ignore_missing = true })
				end,
			},
		})
	end,
}
