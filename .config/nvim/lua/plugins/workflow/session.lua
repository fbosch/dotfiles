local cwd = vim.v.cwd or vim.fn.getcwd(0)
local function get_cwd_as_name()
	return cwd:gsub("[^A-Za-z0-9]", "_")
end
local root_dir = vim.fn.expand("~/.config") .. "/nvim/.sessions//"
local bundle = root_dir .. get_cwd_as_name()

return {
	"rmagatti/auto-session",
	dependencies = {
		"stevearc/overseer.nvim",
	},
	opts = {
		log_level = "error",
		root_dir = root_dir,
		auto_restore = true,
		cwd_change_handling = true,
		purge_after_minutes = 2880, -- 2 days
		pre_save_cmds = {
			function()
				local overseer = require("overseer")
				overseer.save_task_bundle(bundle, nil, { on_conflict = "overwrite" })
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
	},
}
