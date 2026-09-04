local M = {}

local session_header_max_bytes = 1024 * 1024
local settings_max_bytes = 1024 * 1024
local max_session_directories = 1024
local max_directory_entries = 10000

local function canonical_path(path, base)
	if type(path) ~= "string" or path == "" then
		return nil
	end

	if path == "~" then
		path = vim.fn.expand("~")
	elseif path:sub(1, 2) == "~/" then
		path = vim.fn.expand("~") .. path:sub(2)
	elseif path:sub(1, 1) ~= "/" then
		path = vim.fs.joinpath(base or vim.fn.getcwd(), path)
	end

	local normalized = vim.fs.normalize(path)
	return vim.uv.fs_realpath(normalized) or normalized
end

local function read_file_prefix(path, limit)
	local stat = vim.uv.fs_lstat(path)
	if stat == nil or stat.type ~= "file" then
		return nil
	end

	local descriptor = vim.uv.fs_open(path, "r", 438)
	if descriptor == nil then
		return nil
	end
	local contents = vim.uv.fs_read(descriptor, limit + 1, 0)
	vim.uv.fs_close(descriptor)
	return contents
end

local function read_settings_session_dir(path, cwd)
	local contents = read_file_prefix(path, settings_max_bytes)
	if contents == nil or #contents > settings_max_bytes then
		return nil
	end

	local ok, settings = pcall(vim.json.decode, contents)
	if not ok or type(settings) ~= "table" then
		return nil
	end
	return canonical_path(settings.sessionDir, cwd)
end

local function read_session_header(path)
	local contents = read_file_prefix(path, session_header_max_bytes)
	if contents == nil then
		return nil
	end

	local newline = contents:find("\n", 1, true)
	if newline == nil and #contents > session_header_max_bytes then
		return nil
	end
	local line = newline == nil and contents or contents:sub(1, newline - 1)
	local ok, header = pcall(vim.json.decode, line)
	if not ok or type(header) ~= "table" or header.type ~= "session" then
		return nil
	end
	return header
end

local function session_directories(cwd)
	local directories = {}
	local seen = {}
	local search_limited = false

	local function add(path)
		path = canonical_path(path, cwd)
		if path == nil or seen[path] then
			return
		end
		if #directories >= max_session_directories then
			search_limited = true
			return
		end
		seen[path] = true
		table.insert(directories, path)
	end

	local configured_agent_dir = vim.env.PI_CODING_AGENT_DIR
	if type(configured_agent_dir) ~= "string" or configured_agent_dir == "" then
		configured_agent_dir = "~/.pi/agent"
	end
	local agent_dir = canonical_path(configured_agent_dir, cwd)
	local project_settings = vim.fs.joinpath(cwd, ".pi", "settings.json")
	local global_settings = vim.fs.joinpath(agent_dir, "settings.json")
	add(vim.env.PI_CODING_AGENT_SESSION_DIR)
	add(read_settings_session_dir(project_settings, cwd))
	add(read_settings_session_dir(global_settings, cwd))

	local sessions_root = vim.fs.joinpath(agent_dir, "sessions")
	local encoded_cwd = cwd:gsub("^/", ""):gsub("[/:]", "-")
	add(vim.fs.joinpath(sessions_root, "--" .. encoded_cwd .. "--"))

	local root_stat = vim.uv.fs_stat(sessions_root)
	if root_stat ~= nil and root_stat.type == "directory" then
		local ok, iterator = pcall(vim.fs.dir, sessions_root)
		if ok and iterator ~= nil then
			for name, kind in iterator do
				if kind == "directory" then
					add(vim.fs.joinpath(sessions_root, name))
				end
				if search_limited then
					break
				end
			end
		end
	end

	return directories, search_limited
end

function M.find_exact(session_id, expected_cwd)
	local cwd = canonical_path(expected_cwd)
	if cwd == nil then
		return nil, "wrong_worktree"
	end

	local suffix = "_" .. session_id .. ".jsonl"
	local directories, search_limited = session_directories(cwd)
	local matches = {}
	local wrong_worktree = false
	local invalid_session = false
	local entries = 0

	for _, directory in ipairs(directories) do
		local stat = vim.uv.fs_stat(directory)
		if stat ~= nil and stat.type == "directory" then
			local ok, iterator = pcall(vim.fs.dir, directory)
			if ok and iterator ~= nil then
				for name, kind in iterator do
					entries = entries + 1
					if entries > max_directory_entries then
						search_limited = true
						break
					end
					if name:sub(-#suffix) == suffix then
						local path = vim.fs.joinpath(directory, name)
						local header = kind == "file" and read_session_header(path) or nil
						if
							header == nil
							or header.id ~= session_id
							or type(header.cwd) ~= "string"
							or header.cwd:sub(1, 1) ~= "/"
						then
							invalid_session = true
						elseif canonical_path(header.cwd) == cwd then
							table.insert(matches, directory)
						else
							wrong_worktree = true
						end
					end
				end
			end
		end
		if search_limited then
			break
		end
	end

	if search_limited then
		return nil, "search_limit"
	end
	if #matches == 1 then
		return { cwd = cwd, directory = matches[1] }
	end
	if #matches > 1 then
		return nil, "ambiguous"
	end
	if wrong_worktree then
		return nil, "wrong_worktree"
	end
	if invalid_session then
		return nil, "invalid_session"
	end
	return nil, "missing"
end

return M
