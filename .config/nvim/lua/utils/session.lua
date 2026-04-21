local M = {}

local root_dir = vim.fn.expand("~/.config") .. "/nvim/.sessions//"

local function resolve_cwd(cwd)
	if type(cwd) == "string" and cwd ~= "" then
		return cwd
	end

	if type(vim.v.cwd) == "string" and vim.v.cwd ~= "" then
		return vim.v.cwd
	end

	return vim.fn.getcwd(0)
end

function M.get_root_dir()
	return root_dir
end

function M.get_name(cwd)
	return resolve_cwd(cwd):gsub("[^A-Za-z0-9]", "_")
end

function M.get_path(cwd)
	return root_dir .. M.get_name(cwd)
end

function M.get_opencode_sidecar_path(cwd)
	return M.get_path(cwd) .. ".opencode"
end

function M.get_opencode_path(cwd)
	return M.get_opencode_sidecar_path(cwd)
end

function M.read_opencode_id(cwd)
	local path = M.get_opencode_sidecar_path(cwd)
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

function M.write_opencode_id(session_id, cwd)
	if type(session_id) ~= "string" or session_id == "" then
		return false
	end

	local stat = vim.uv.fs_stat(root_dir)
	if not stat or stat.type ~= "directory" then
		return false
	end

	local ok, result = pcall(vim.fn.writefile, { session_id }, M.get_opencode_sidecar_path(cwd))
	if ok == false then
		return false
	end

	return result == 0
end

function M.clear_opencode_id(cwd)
	local path = M.get_opencode_sidecar_path(cwd)
	local stat = vim.uv.fs_stat(path)
	if not stat then
		return true
	end

	return vim.fn.delete(path) == 0
end

return M
