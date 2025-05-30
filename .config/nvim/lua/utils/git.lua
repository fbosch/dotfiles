local M = {}

function M.get_remote_url()
	local handle = io.popen("git config --get remote.origin.url 2>/dev/null")
	if handle == nil then
		return nil
	end

	local result = handle:read("*a")
	handle:close()

	result = result and result:gsub("%s+", "")
	return result ~= "" and result or nil
end

function M.get_branch_name()
	local handle = io.popen("git rev-parse --abbrev-ref HEAD 2>/dev/null")
	if handle == nil then
		return nil
	end

	local result = handle:read("*a")
	handle:close()

	result = result and result:gsub("%s+", "")
	return result ~= "" and result or nil
end

function M.extract_workitem_id_from_branch()
	local branch = M.get_branch_name()
	if not branch then
		return nil
	end
	local id = branch:match("/(%d+)%D") or branch:match("/(%d+)$")
	return id
end

function M.extract_azure_org(url)
	local org, project = url:match("https://[^@]*@?dev%.azure%.com/([^/]+)/([^/]+)/_git")
	if org and project then
		return string.format("https://dev.azure.com/%s/%s", org, project)
	end

	local user = url:match("https://([^@]+)@visualstudio%.com")
	local legacy_project = url:match("visualstudio%.com/([^/]+)/_git")
	if user and legacy_project then
		return string.format("https://%s.visualstudio.com/%s", user, legacy_project)
	end

	return nil
end

local is_git_repo = nil
function M.is_git_repo()
	if is_git_repo then
		return is_git_repo
	end
	local root = vim.fs.root(vim.fn.getcwd(), { ".git" })
	is_git_repo = root and true or false
	return is_git_repo
end

return M
