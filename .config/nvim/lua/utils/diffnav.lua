local terminal = require("utils.terminal")

local M = {}
local active_instance
local origin_win

function M.editor_env(env)
	local editor =
		assert(vim.api.nvim_get_runtime_file("scripts/diffnav-editor", false)[1], "diffnav editor wrapper missing")
	local server = vim.v.servername
	if server == "" then
		server = vim.fn.serverstart()
	end
	return vim.tbl_extend("force", env, {
		EDITOR = editor,
		NVIM = server,
		DIFFNAV_NVIM = vim.v.progpath,
	})
end

function M.toggle(instance)
	local win = vim.api.nvim_get_current_win()
	if vim.api.nvim_win_get_config(win).relative == "" then
		origin_win = win
	end
	active_instance = instance
	terminal.toggle_floating_terminal(instance)
	if instance.win and vim.api.nvim_win_is_valid(instance.win) then
		require("utils").set_keymap("t", "<CR>", "o", {
			buffer = vim.api.nvim_win_get_buf(instance.win),
			desc = "open diffnav file in Neovim",
		})
	end
end

function M.open_file(path)
	local ok, err = pcall(function()
		assert(type(path) == "string" and path ~= "", "No diffnav file selected")
		local stat = vim.uv.fs_stat(path)
		assert(stat and stat.type == "file", "Selected diffnav path is not an existing file")
		assert(active_instance, "No active diffnav terminal")

		local target = origin_win
		if not target or not vim.api.nvim_win_is_valid(target) then
			target = nil
			for _, win in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
				if vim.api.nvim_win_get_config(win).relative == "" then
					target = win
					break
				end
			end
		end
		assert(target, "No editor window available for diffnav file")
		-- Keep filenames as data, including Ex metacharacters, and never force away unsaved edits.
		vim.api.nvim_win_call(target, function()
			vim.cmd.edit({ args = { path }, magic = { file = false, bar = false } })
		end)
		vim.cmd.stopinsert()
		terminal.close_floating_terminal(active_instance)
		vim.api.nvim_set_current_win(target)
	end)
	if not ok then
		vim.notify(tostring(err), vim.log.levels.ERROR)
	end
	return ok
end

return M
