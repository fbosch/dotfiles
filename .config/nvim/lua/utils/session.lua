local M = {}

local root_dir = vim.fn.stdpath("config") .. "/.sessions/"
local metadata_dir = root_dir .. ".metadata/"
local current_session
local max_herdr_session_specifier_length = 80

local function resolve_cwd(cwd)
	if type(cwd) ~= "string" or cwd == "" then
		cwd = vim.v.cwd ~= "" and vim.v.cwd or vim.fn.getcwd(0)
	end

	local absolute = vim.fs.abspath(cwd)
	return vim.uv.fs_realpath(absolute) or vim.fs.normalize(absolute)
end

local function read_metadata(path)
	if vim.fn.filereadable(path) == 0 then
		return {}
	end

	local ok, metadata = pcall(vim.json.decode, table.concat(vim.fn.readfile(path), "\n"))
	return ok and type(metadata) == "table" and metadata or {}
end

local function session_name(cwd, specifier)
	return vim.fn.sha256(cwd) .. "--" .. specifier .. ".vim"
end

local function session_from_name(cwd, name)
	local specifier = name:match("^" .. vim.pesc(vim.fn.sha256(cwd)) .. "%-%-(.+)%.vim$")
	if specifier == nil then
		return nil
	end

	return {
		cwd = cwd,
		specifier = specifier,
		name = name,
		path = root_dir .. name,
		metadata_path = metadata_dir .. name .. ".json",
	}
end

function M.get_root_dir()
	return root_dir
end

function M.resolve(cwd, specifier)
	cwd = resolve_cwd(cwd)
	specifier = specifier or "default"
	return {
		cwd = cwd,
		specifier = specifier,
		name = session_name(cwd, specifier),
		path = root_dir .. session_name(cwd, specifier),
		metadata_path = metadata_dir .. session_name(cwd, specifier) .. ".json",
	}
end

function M.resolve_requested(cwd)
	local specifier = vim.env.NVIM_SESSION
	vim.env.NVIM_SESSION = nil

	if specifier ~= nil and specifier ~= "" then
		local exceeds_herdr_limit = vim.env.HERDR_ENV == "1" and #specifier > max_herdr_session_specifier_length
		if exceeds_herdr_limit or specifier:match("^[A-Za-z0-9][A-Za-z0-9_-]*$") == nil then
			vim.notify("Ignoring invalid NVIM_SESSION: " .. specifier, vim.log.levels.WARN)
		else
			return M.resolve(cwd, specifier), true
		end
	end

	cwd = resolve_cwd(cwd)
	local workspace_id, pane_id = (vim.env.HERDR_ENV == "1" and vim.env.HERDR_PANE_ID or ""):match(
		"^w([A-Za-z0-9_-]+):p([A-Za-z0-9_-]+)$"
	)
	if workspace_id ~= nil then
		return M.resolve(cwd, ("herdr-w%s-p%s"):format(workspace_id, pane_id)), true
	end

	local sessions = {}
	for _, path in ipairs(vim.fn.glob(root_dir .. vim.fn.sha256(cwd) .. "--*.vim", false, true)) do
		local name = vim.fs.basename(path)
		local session = session_from_name(cwd, name)
		if session ~= nil then
			session.last_used_at = tonumber(read_metadata(session.metadata_path).last_used_at) or vim.fn.getftime(path)
			table.insert(sessions, session)
		end
	end

	table.sort(sessions, function(a, b)
		return a.last_used_at > b.last_used_at
	end)
	if sessions[1] ~= nil then
		return sessions[1], false
	end

	return M.resolve(cwd), false
end

function M.set_current(session)
	current_session = session
end

function M.set_herdr_restore_pending(pending, herdr, session)
	session = session or M.get_current()
	if session == nil then
		return false
	end

	local metadata = M.get_metadata(session)
	if pending then
		metadata.cwd = session.cwd
		metadata.herdr_managed = true
		metadata.herdr_pane_id = herdr.pane_id
		metadata.herdr_tab_id = herdr.tab_id
		metadata.herdr_workspace_id = herdr.workspace_id
		metadata.specifier = session.specifier
	end
	metadata.restore_pending = pending
	M.set_metadata(metadata, session)
	return true
end

function M.get_current(cwd)
	if current_session ~= nil and (cwd == nil or current_session.cwd == resolve_cwd(cwd)) then
		return current_session
	end

	return nil
end

function M.get_metadata(session)
	return read_metadata(session.metadata_path)
end

function M.set_metadata(metadata, session)
	vim.fn.mkdir(vim.fs.dirname(session.metadata_path), "p")
	vim.fn.writefile({ vim.json.encode(metadata) }, session.metadata_path)
end

function M.touch(session)
	local metadata = M.get_metadata(session)
	local seconds, microseconds = vim.uv.gettimeofday()
	metadata.last_used_at = seconds * 1000 + math.floor(microseconds / 1000)
	M.set_metadata(metadata, session)
end

function M.set_opencode_session_id(session_id, session)
	if type(session_id) ~= "string" or session_id:match("^ses_[A-Za-z0-9]+$") == nil then
		return false
	end

	session = session or M.get_current()
	if session == nil then
		return false
	end

	local metadata = M.get_metadata(session)
	if metadata.opencode_session_id == session_id then
		return true
	end

	metadata.opencode_session_id = session_id
	M.set_metadata(metadata, session)
	return true
end

function M.is_valid_pi_session_id(session_id)
	return type(session_id) == "string"
		and session_id:match("^[A-Za-z0-9._-]+$") ~= nil
		and session_id:match("^[A-Za-z0-9]") ~= nil
		and session_id:match("[A-Za-z0-9]$") ~= nil
end

function M.set_pi_terminal_state(session_id, is_open, session)
	if type(is_open) ~= "boolean" or (session_id ~= nil and not M.is_valid_pi_session_id(session_id)) then
		return false
	end
	if is_open and session_id == nil then
		return false
	end

	session = session or M.get_current()
	if session == nil then
		return false
	end

	local metadata = M.get_metadata(session)
	local changed = metadata.pi_terminal_open ~= is_open
	metadata.pi_terminal_open = is_open
	if session_id ~= nil and metadata.pi_session_id ~= session_id then
		metadata.pi_session_id = session_id
		changed = true
	end
	if changed then
		M.set_metadata(metadata, session)
	end
	return true
end

return M
