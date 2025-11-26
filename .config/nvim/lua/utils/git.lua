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
	local org, project = url:match("https://[^@/]*@?dev%.azure%.com/([^/]+)/([^/]+)/_git")
	if org and project then
		return string.format("https://dev.azure.com/%s/%s", org, project)
	end

	local user, legacy_org, legacy_project = url:match("https://([^@]+)@([^.]+)%.visualstudio%.com/.+/(.+)/_git")
	if user and legacy_org and legacy_project then
		return string.format("https://%s.visualstudio.com/%s", legacy_org, legacy_project)
	end

	local ssh_org, ssh_project = url:match("git@ssh%.dev%.azure%.com:v3/([^/]+)/([^/]+)/[^/]+")
	if ssh_org and ssh_project then
		return string.format("https://dev.azure.com/%s/%s", ssh_org, ssh_project)
	end

	local vs_ssh_org, vs_ssh_project = url:match("[^@]+@vs%-ssh%.visualstudio%.com:v3/([^/]+)/([^/]+)/[^/]+")
	if vs_ssh_org and vs_ssh_project then
		return string.format("https://%s.visualstudio.com/%s", vs_ssh_org, vs_ssh_project)
	end

	return nil
end

function M.is_git_repo()
	-- Check if the current buffer's file is in a git repo
	-- This is dynamic and rechecks each time, no global caching
	local bufpath = vim.api.nvim_buf_get_name(0)
	local path = bufpath ~= "" and bufpath or vim.fn.getcwd()
	local root = vim.fs.root(path, { ".git" })
	return root ~= nil
end

function M.is_git_message_buffer()
	local bufname = vim.api.nvim_buf_get_name(0)
	local filename = vim.fn.fnamemodify(bufname, ":t")
	local git_msg_files = {
		"COMMIT_EDITMSG",
		"MERGE_MSG",
		"TAG_EDITMSG",
		"SQUASH_MSG",
		"REBASE_EDITMSG",
		"PULLREQ_EDITMSG",
		"EDIT_DESCRIPTION",
	}
	for _, pattern in ipairs(git_msg_files) do
		if filename == pattern then
			return true
		end
	end
	if os.getenv("GIT_EDITOR") or os.getenv("GIT_COMMIT") then
		return true
	end
	return false
end

return M
