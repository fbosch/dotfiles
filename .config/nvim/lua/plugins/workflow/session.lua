local git = require("utils.git")
local session = require("utils.session")

local root_dir = session.get_root_dir()
local session_file = session.get_name()
local path = session.get_path()

local should_persist_session = not (
	git.is_git_message_buffer() -- opened git message buffer
	or vim.fn.argc() > 0 -- opened specific file
)

return {
	{
		"echasnovski/mini.sessions",
		version = "*",
		lazy = false,
		priority = 500,
		cond = should_persist_session,
		config = function()
			local sessions = require("mini.sessions")
			local opencode_session = require("utils.opencode_session")
			sessions.setup({
				directory = root_dir,
				file = "",
				hooks = {
					pre = {
						write = function()
							local tree_ok, tree_api = pcall(require, "nvim-tree.api")
							if tree_ok then
								tree_api.tree.close()
							end
							vim.api.nvim_exec_autocmds("User", { pattern = "SessionSavePre" })
						end,
					},
				},
				verbose = {
					read = false,
					write = false,
					delete = false,
				},
			})

			vim.api.nvim_create_autocmd({ "VimEnter" }, {
				callback = function()
					local existing_session = vim.loop.fs_stat(path)
					if existing_session and existing_session.type == "file" then
						vim.defer_fn(function()
							sessions.read(session_file)
							vim.api.nvim_exec_autocmds("User", { pattern = "SessionLoadPost" })
						end, 50)
					end
				end,
			})

			vim.api.nvim_create_autocmd({ "VimLeavePre" }, {
				callback = function()
					local dir_exists = vim.loop.fs_stat(root_dir)
					if dir_exists and dir_exists.type == "directory" then
						opencode_session.persist_current_session_id()
						sessions.write(session_file)
					end
				end,
			})
		end,
	},
}
