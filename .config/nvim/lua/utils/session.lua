local M = {}

local cwd = vim.v.cwd ~= "" and vim.v.cwd or vim.fn.getcwd(0)
local root_dir = vim.fn.expand("~/.config") .. "/nvim/.sessions//"

function M.get_root_dir()
	return root_dir
end

function M.get_name()
	return cwd:gsub("[^A-Za-z0-9]", "_")
end

function M.get_path()
	return root_dir .. M.get_name()
end

function M.get_opencode_path()
	return M.get_path() .. ".opencode"
end

function M.read_opencode_id()
	local path = M.get_opencode_path()
	local stat = vim.uv.fs_stat(path)
	if not stat or stat.type ~= "file" then
		return nil
	end

	local lines = vim.fn.readfile(path, "", 1)
	local session_id = lines[1]
	if type(session_id) ~= "string" or session_id == "" then
		return nil
	end

	return session_id
end

function M.write_opencode_id(session_id)
	if type(session_id) ~= "string" or session_id == "" then
		return false
	end

	local stat = vim.uv.fs_stat(root_dir)
	if not stat or stat.type ~= "directory" then
		return false
	end

	return pcall(vim.fn.writefile, { session_id }, M.get_opencode_path())
end

return M
