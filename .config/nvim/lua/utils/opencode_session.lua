local session = require("utils.session")

local M = {}

local current_session_id = session.read_opencode_id()
local sync_request_id = 0
local restore_request_id = 0
local default_sync_delays = { 500, 2000 }
local default_restore_delays = { 100, 400, 1200, 2500 }
local last_restore_state = {
	status = "idle",
	detail = "not started",
	at = nil,
}

local function set_last_restore_state(status, detail)
	last_restore_state = {
		status = status,
		detail = detail,
		at = os.time(),
	}
end

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

local function common_prefix_score(path_a, path_b)
	if type(path_a) ~= "string" or path_a == "" then
		return 0
	end

	if type(path_b) ~= "string" or path_b == "" then
		return 0
	end

	local segments_a = vim.split(vim.fs.normalize(path_a), "/", { plain = true, trimempty = true })
	local segments_b = vim.split(vim.fs.normalize(path_b), "/", { plain = true, trimempty = true })
	local score = 0

	for i = 1, math.min(#segments_a, #segments_b) do
		if segments_a[i] ~= segments_b[i] then
			break
		end
		score = score + 1
	end

	return score
end

local function pick_server_for_cwd(servers, cwd)
	if type(servers) ~= "table" or vim.tbl_isempty(servers) then
		return nil
	end

	if #servers == 1 then
		return servers[1]
	end

	local best_server = nil
	local best_score = -1
	local tie = false

	for _, server in ipairs(servers) do
		if type(server) == "table" and type(server.cwd) == "string" and server.cwd ~= "" then
			local score = common_prefix_score(cwd, server.cwd)
			if score > best_score then
				best_server = server
				best_score = score
				tie = false
			elseif score == best_score then
				tie = true
			end
		end
	end

	if best_score <= 0 or tie then
		return nil
	end

	return best_server
end

local function sessions_include_id(sessions, session_id)
	if type(session_id) ~= "string" or session_id == "" then
		return false
	end

	for _, item in ipairs(sessions) do
		if type(item) == "table" and item.id == session_id then
			return true
		end
	end

	return false
end

local function get_server_sessions(server, on_sessions)
	if type(on_sessions) ~= "function" then
		return false
	end

	if type(server.get_sessions) == "function" then
		server:get_sessions(on_sessions)
		return true
	end

	local ok_client, opencode_client = pcall(require, "opencode.cli.client")
	if not ok_client or type(opencode_client.get_sessions) ~= "function" or type(server.port) ~= "number" then
		return false
	end

	opencode_client.get_sessions(server.port, on_sessions)
	return true
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
	local ok_events, opencode_events = pcall(require, "opencode.events")
	if not ok_events then
		return
	end

	local server = opencode_events.connected_server
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
end

function M.get_current_session_id()
	return current_session_id
end

function M.get_last_restore_state()
	return vim.deepcopy(last_restore_state)
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

function M.sync_from_event(session_id)
	if type(session_id) ~= "string" or session_id == "" then
		return false
	end

	return M.set_current_session_id(session_id)
end

function M.select_session_on_connected_server(session_id)
	local target_session_id = session_id
	if type(target_session_id) ~= "string" or target_session_id == "" then
		target_session_id = current_session_id
	end

	if type(target_session_id) ~= "string" or target_session_id == "" then
		target_session_id = M.restore_saved_session_id()
	end

	if type(target_session_id) ~= "string" or target_session_id == "" then
		set_last_restore_state("skipped", "no session id")
		return false
	end

	local ok_events, opencode_events = pcall(require, "opencode.events")
	if not ok_events then
		set_last_restore_state("skipped", "events unavailable")
		return false
	end

	local server = opencode_events.connected_server
	if type(server) ~= "table" or type(server.port) ~= "number" then
		set_last_restore_state("skipped", "no connected server")
		return false
	end

	local ok_client, opencode_client = pcall(require, "opencode.cli.client")
	if not ok_client or type(opencode_client.select_session) ~= "function" then
		set_last_restore_state("skipped", "client unavailable")
		return false
	end

	local ok_sessions = get_server_sessions(server, function(sessions)
		if type(sessions) ~= "table" then
			set_last_restore_state("skipped", "session list unavailable")
			return
		end

		local selected_session_id = target_session_id
		if sessions_include_id(sessions, target_session_id) == false then
			selected_session_id = select_session_id(sessions)
			if type(selected_session_id) ~= "string" or selected_session_id == "" then
				set_last_restore_state("skipped", "saved session stale; no fallback")
				return
			end

			M.set_current_session_id(selected_session_id)
			set_last_restore_state("recovered", "stale session replaced with " .. selected_session_id)
		else
			M.set_current_session_id(selected_session_id)
		end

		opencode_client.select_session(server.port, selected_session_id)
		if sessions_include_id(sessions, target_session_id) then
			set_last_restore_state("selected", "session " .. selected_session_id)
		else
			set_last_restore_state("recovered", "selected fallback on port " .. tostring(server.port))
		end
	end)

	if ok_sessions == false then
		set_last_restore_state("skipped", "session listing unavailable")
		return false
	end

	set_last_restore_state("restoring", "validating session " .. target_session_id)
	return true
end

function M.connect_server_noninteractive()
	local ok_events, opencode_events = pcall(require, "opencode.events")
	if not ok_events then
		set_last_restore_state("skipped", "events unavailable")
		return false
	end

	if type(opencode_events.connected_server) == "table" then
		set_last_restore_state("connected", "server already connected")
		return true
	end

	local ok_server, opencode_server = pcall(require, "opencode.cli.server")
	if not ok_server or type(opencode_server.get_all) ~= "function" then
		set_last_restore_state("skipped", "server discovery unavailable")
		return false
	end

	set_last_restore_state("connecting", "discovering servers")
	opencode_server
		.get_all()
		:next(function(servers)
			local server = pick_server_for_cwd(servers, vim.fn.getcwd())
			if server then
				opencode_events.connect(server)
				set_last_restore_state("connecting", "connecting to port " .. tostring(server.port))
				return
			end

			set_last_restore_state("skipped", "no non-interactive server match")
		end)
		:catch(function()
			set_last_restore_state("skipped", "server discovery failed")
		end)

	return true
end

function M.request_restore_on_connected_server(opts)
	opts = opts or {}
	local delays = opts.delays or default_restore_delays
	restore_request_id = restore_request_id + 1
	local request_id = restore_request_id
	set_last_restore_state("scheduled", "restore retries enqueued")

	for _, delay in ipairs(delays) do
		vim.defer_fn(function()
			if request_id ~= restore_request_id then
				return
			end

			M.connect_server_noninteractive()
			M.select_session_on_connected_server()
		end, delay)
	end

	return true
end

function M.select_and_persist()
	local ok_select, select_session = pcall(require, "opencode.ui.select_session")
	if not ok_select or type(select_session.select_session) ~= "function" then
		set_last_restore_state("skipped", "session picker unavailable")
		return false
	end

	set_last_restore_state("selecting", "awaiting session selection")

	return select_session
		.select_session()
		:next(function(result)
			if type(result) ~= "table" then
				set_last_restore_state("skipped", "no selection result")
				return
			end

			local selected_session = result.session
			local selected_port = result.port
			if
				type(selected_session) ~= "table"
				or type(selected_session.id) ~= "string"
				or selected_session.id == ""
			then
				set_last_restore_state("skipped", "invalid selected session")
				return
			end

			sync_request_id = sync_request_id + 1
			restore_request_id = restore_request_id + 1
			M.set_current_session_id(selected_session.id)
			set_last_restore_state("selected", "session " .. selected_session.id)

			local ok_client, opencode_client = pcall(require, "opencode.cli.client")
			if
				not ok_client
				or type(opencode_client.select_session) ~= "function"
				or type(selected_port) ~= "number"
			then
				set_last_restore_state("selected", "persisted only (client unavailable)")
				return
			end

			opencode_client.select_session(selected_port, selected_session.id)
			set_last_restore_state("selected", "persisted and selected on port " .. tostring(selected_port))
		end)
		:catch(function(err)
			if err then
				set_last_restore_state("error", tostring(err))
				vim.notify(err, vim.log.levels.ERROR, { title = "opencode" })
				return
			end

			set_last_restore_state("cancelled", "selection cancelled")
		end)
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
