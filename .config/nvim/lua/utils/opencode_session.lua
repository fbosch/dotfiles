local session = require("utils.session")

local M = {}

local current_session_id = session.read_opencode_id()
local sync_request_id = 0
local default_sync_delays = { 100, 400, 1000, 2500 }

local function is_empty(value)
	return value == nil or value == vim.NIL or value == ""
end

local function session_updated_at(item)
	if type(item.updated) == "number" then
		return item.updated
	end

	local time = item.time
	if type(time) == "table" then
		return time.updated or time.created or 0
	end

	return item.created or 0
end

local function session_directory(item)
	return item.directory or item.worktree
end

local function session_matches_cwd(item, cwd)
	local directory = session_directory(item)
	if type(directory) ~= "string" or directory == "" then
		return false
	end

	return directory:find(cwd, 1, true) == 1 or cwd:find(directory, 1, true) == 1
end

local function is_root_session(item)
	return is_empty(item.parentID) and is_empty(item.parentId) and is_empty(item.parent_id)
end

local function sort_sessions_by_recent(a, b)
	return session_updated_at(a) > session_updated_at(b)
end

local function select_session_id(sessions)
	local cwd = vim.fn.getcwd()
	local candidates = {}
	local root_candidates = {}
	local all_candidates = {}
	local all_root_candidates = {}

	for _, item in ipairs(sessions) do
		if type(item) == "table" and type(item.id) == "string" and item.id ~= "" then
			table.insert(all_candidates, item)
			if is_root_session(item) then
				table.insert(all_root_candidates, item)
			end

			if session_matches_cwd(item, cwd) then
				table.insert(candidates, item)
				if is_root_session(item) then
					table.insert(root_candidates, item)
				end
			end
		end
	end

	local matches = root_candidates
	if vim.tbl_isempty(matches) then
		matches = candidates
	end
	if vim.tbl_isempty(matches) then
		matches = all_root_candidates
	end
	if vim.tbl_isempty(matches) then
		matches = all_candidates
	end

	if vim.tbl_isempty(matches) then
		return nil
	end

	table.sort(matches, sort_sessions_by_recent)
	return matches[1].id
end

local function sync_from_server(request_id)
	local ok, opencode_server = pcall(require, "opencode.cli.server")
	if not ok then
		ok, opencode_server = pcall(require, "opencode.server")
	end

	if not ok then
		return
	end

	opencode_server
		.get(false)
		:next(function(server)
			if type(server) ~= "table" then
				return
			end

			local function on_sessions(sessions)
				if type(sessions) ~= "table" then
					return
				end

				if request_id ~= sync_request_id then
					return
				end

				local session_id = select_session_id(sessions)
				if session_id then
					M.set_current_session_id(session_id)
				end
			end

			if type(server.get_sessions) == "function" then
				server:get_sessions(on_sessions)
				return
			end

			local ok_client, opencode_client = pcall(require, "opencode.cli.client")
			if not ok_client or type(opencode_client.get_sessions) ~= "function" or type(server.port) ~= "number" then
				return
			end

			opencode_client.get_sessions(server.port, on_sessions)
		end)
		:catch(function() end)
end

function M.get_current_session_id()
	return current_session_id
end

function M.set_current_session_id(session_id)
	if type(session_id) ~= "string" or session_id == "" then
		return false
	end

	local ok = session.write_opencode_id(session_id)
	if ok then
		current_session_id = session_id
	end

	return ok
end

function M.clear_current_session_id()
	current_session_id = nil
	return session.clear_opencode_id()
end

function M.persist_current_session_id()
	if type(current_session_id) ~= "string" or current_session_id == "" then
		return false
	end

	return session.write_opencode_id(current_session_id)
end

function M.restore_saved_session_id()
	current_session_id = session.read_opencode_id()
	return current_session_id
end

function M.build_start_command(base_command)
	local saved_session_id = M.restore_saved_session_id()
	if type(saved_session_id) ~= "string" or saved_session_id == "" then
		return base_command
	end

	if base_command:find("--session", 1, true) then
		return base_command
	end

	return base_command .. " --session " .. vim.fn.shellescape(saved_session_id)
end

function M.request_sync(opts)
	opts = opts or {}
	sync_request_id = sync_request_id + 1
	local request_id = sync_request_id
	local delays = opts.delays or default_sync_delays

	for _, delay in ipairs(delays) do
		vim.defer_fn(function()
			if request_id == sync_request_id then
				sync_from_server(request_id)
			end
		end, delay)
	end

	return request_id
end

function M.sync_now()
	return M.request_sync({ delays = { 0 } })
end

return M
