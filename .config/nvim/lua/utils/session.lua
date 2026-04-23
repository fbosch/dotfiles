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

return M
