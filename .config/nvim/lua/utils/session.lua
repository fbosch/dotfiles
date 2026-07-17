local M = {}

local root_dir = vim.fn.expand("~/.config") .. "/nvim/.sessions//"
local metadata_dir = root_dir .. ".metadata/"

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

function M.get_metadata(cwd)
	local path = metadata_dir .. M.get_name(cwd) .. ".json"
	if vim.fn.filereadable(path) == 0 then
		return {}
	end

	local ok, metadata = pcall(vim.json.decode, table.concat(vim.fn.readfile(path), "\n"))
	if ok == false or type(metadata) ~= "table" then
		return {}
	end

	return metadata
end

function M.set_metadata(metadata, cwd)
	vim.fn.mkdir(metadata_dir, "p")
	vim.fn.writefile({ vim.json.encode(metadata) }, metadata_dir .. M.get_name(cwd) .. ".json")
end

function M.set_opencode_session_id(session_id, cwd)
	if type(session_id) ~= "string" or session_id:match("^ses_[A-Za-z0-9]+$") == nil then
		return false
	end

	local metadata = M.get_metadata(cwd)
	if metadata.opencode_session_id == session_id then
		return true
	end

	metadata.opencode_session_id = session_id
	M.set_metadata(metadata, cwd)
	return true
end

return M
