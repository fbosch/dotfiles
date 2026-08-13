local git = require("utils.git")
local session = require("utils.session")
local register = require("config.pack.registry").register

local function mark_herdr_pane()
	local pane_id = vim.env.HERDR_PANE_ID
	if vim.env.HERDR_ENV ~= "1" or type(pane_id) ~= "string" or pane_id == "" then
		return
	end

	vim.system({ "herdr", "pane", "rename", pane_id, "nvim" }, { detach = true })
end

local should_persist_session = not (
	git.is_git_message_buffer() -- opened git message buffer
	or vim.fn.argc() > 0 -- opened specific file
)

register({
	{
		name = "mini.sessions",
		src = "https://github.com/echasnovski/mini.sessions.git",
		version = vim.version.range("*"),
		startup = true,
		condition = function()
			return should_persist_session
		end,
		setup = function()
			local sessions = require("mini.sessions")
			local target = session.resolve_requested()
			session.set_current(target)
			sessions.setup({
				directory = session.get_root_dir(),
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
					post = {
						read = function()
							session.touch(target)
							vim.api.nvim_exec_autocmds("User", { pattern = "SessionLoadPost" })
						end,
						write = function()
							session.touch(target)
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
					mark_herdr_pane()
					local existing_session = vim.uv.fs_stat(target.path)
					if existing_session and existing_session.type == "file" then
						vim.defer_fn(function()
							sessions.read(target.name, { force = true })
						end, 50)
					end
				end,
			})

			vim.api.nvim_create_autocmd({ "VimLeavePre" }, {
				callback = function()
					local dir_exists = vim.uv.fs_stat(session.get_root_dir())
					if dir_exists and dir_exists.type == "directory" then
						sessions.write(target.name)
					end
				end,
			})
		end,
	},
})
