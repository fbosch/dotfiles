local git = require("utils.git")
local cwd = vim.v.cwd or vim.fn.getcwd(0)
local function get_cwd_as_name()
	return cwd:gsub("[^A-Za-z0-9]", "_")
end
local root_dir = vim.fn.expand("~/.config") .. "/nvim/.sessions//"

local session_file = get_cwd_as_name()
local path = root_dir .. session_file

return {
	{
		"echasnovski/mini.sessions",
		version = "*",
		lazy = false,
		priority = 500,
		config = function()
			local sessions = require("mini.sessions")
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
						end,
					},
				},
				verbose = {
					read = false,
					write = false,
					delete = false,
				},
			})

			if git.is_git_message_buffer() then
				return -- don't read or write to session if git buffer
			end

			vim.api.nvim_create_autocmd({ "VimEnter" }, {
				callback = function()
					local existing_session = vim.loop.fs_stat(path)
					if existing_session and existing_session.type == "file" then
						sessions.read(session_file)
					end
				end,
			})

			vim.api.nvim_create_autocmd({ "VimLeavePre" }, {
				callback = function()
					sessions.write(session_file)
				end,
			})
		end,
	},
}
