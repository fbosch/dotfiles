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

return M
