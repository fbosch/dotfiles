local M = {}
local platform = require("utils.platform")
local git = require("utils.git")

function M.url_encode(str)
	return (str:gsub("[^%w%-_%.~]", function(c)
		return string.format("%%%02X", string.byte(c))
	end))
end

function M.build_url(endpoint, params)
	if not params or vim.tbl_isempty(params) then
		return endpoint
	end
	local query = {}
	for k, v in pairs(params) do
		if v ~= nil then
			table.insert(query, M.url_encode(k) .. "=" .. M.url_encode(tostring(v)))
		end
	end
	return endpoint .. "?" .. table.concat(query, "&")
end

function M.extract_uris(lines)
	opts = opts or {}
	local uris, seen = {}, {}
	for _, line in ipairs(lines) do
		for url in line:gmatch("%[.-%]%((https?://[^%s%)]+)%)") do
			if not seen[url] then
				table.insert(uris, url)
				seen[url] = true
			end
		end
		for url in line:gmatch("https?://[%w-_%.%?%.:/%+=&%%#@%!]+") do
			if not seen[url] then
				table.insert(uris, url)
				seen[url] = true
			end
		end
	end
	return uris
end

function M.extract_uris_from_selection()
	vim.cmd('normal! ""y')
	local content = vim.fn.getreg('"')

	if not content or content == "" then
		vim.notify("No visual selection found", vim.log.levels.WARN)
		return
	end
	local lines = {}
	for line in content:gmatch("[^\n]+") do
		table.insert(lines, line)
	end
	return M.extract_uris(lines)
end

local CONFIRM_THRESHOLD = 5
function M.open_uris(uris)
	if #uris == 0 then
		vim.notify("No URLs found in buffer", vim.log.levels.INFO)
		return
	end
	local ok, snacks = pcall(require, "snacks")
	if not ok then
		vim.notify("Snacks not found.", vim.log.levels.ERROR)
		return
	end

	if #uris > CONFIRM_THRESHOLD then
		snacks.input({
			prompt = string.format("Open all %d links? (y/N)", #uris),
			icon = "󰖟 ",
			default = "n",
			win = {
				style = "minimal",
				border = "single",
				height = 1,
				width = 40,
				row = math.floor((vim.o.lines - 1) / 2),
				col = math.floor((vim.o.columns - 40) / 2),
			},
		}, function(input)
			if input and input:lower() == "y" then
				for _, uri in ipairs(uris) do
					platform.system_open(uri)
				end
			else
				vim.notify("Cancelled opening links", vim.log.levels.WARN)
			end
		end)
	else
		for _, uri in ipairs(uris) do
			platform.system_open(uri)
		end
	end
end

function M.open_uris_in_buffer(bufnr)
	bufnr = bufnr or vim.api.nvim_get_current_buf()
	local lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
	local uris = M.extract_uris(lines)
	M.open_uris(uris)
end

function M.open_uris_in_selection()
	M.open_uris(M.extract_uris_from_selection())
end

function M.open_branch_workitem()
	local branch = git.get_branch_name()
	if not branch then
		vim.notify("No branch name found", vim.log.levels.WARN)
		return
	end
	local workitem_id = git.extract_workitem_id_from_branch()
	if not workitem_id then
		vim.notify("No workitem ID found in branch name", vim.log.levels.WARN)
		return
	end
	local azure_org = git.extract_azure_org(git.get_remote_url())
	if azure_org then
		platform.system_open(azure_org .. "/_workitems/edit/" .. workitem_id)
	end
end

function M.open_git_remote_url()
	local git_remote_url = git.get_remote_url()

	print(git_remote_url)

	if git_remote_url then
		platform.system_open(git_remote_url)
		return
	end

	vim.notify("Not a git repository", vim.log.levels.INFO)
end

return M
