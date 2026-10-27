local M = {}

local function positive_integer(value)
	return type(value) == "number" and value >= 1 and value == math.floor(value)
end
local function has_uri_scheme(path)
	return type(path) == "string" and path:match("^%a[%w+.-]*:") ~= nil
end
local function canonical_path(path)
	if type(path) ~= "string" or path == "" or has_uri_scheme(path) then
		return nil
	end

	local candidate = vim.fs.normalize(path)
	local missing = {}
	while true do
		local resolved = vim.uv.fs_realpath(candidate)
		if resolved ~= nil then
			for _, segment in ipairs(missing) do
				resolved = vim.fs.joinpath(resolved, segment)
			end
			return vim.fs.normalize(resolved)
		end

		local stat = vim.uv.fs_lstat(candidate)
		if stat ~= nil and stat.type == "link" then
			return nil
		end
		local parent = vim.fs.dirname(candidate)
		if parent == nil or parent == candidate then
			return nil
		end
		table.insert(missing, 1, vim.fs.basename(candidate))
		candidate = parent
	end
end

local function path_is_inside(path, root)
	if path == nil or root == nil then
		return false
	end
	if path == root then
		return true
	end
	if root == "/" then
		return path:sub(1, 1) == "/"
	end
	return path:sub(1, #root + 1) == root .. "/"
end

local function is_source_buffer(buffer, require_loaded)
	if positive_integer(buffer) == false or vim.api.nvim_buf_is_valid(buffer) == false then
		return false
	end
	if require_loaded and vim.api.nvim_buf_is_loaded(buffer) == false then
		return false
	end

	local options = vim.bo[buffer]
	local name = vim.api.nvim_buf_get_name(buffer)
	return name ~= ""
		and has_uri_scheme(name) == false
		and options.buftype == ""
		and options.modifiable
		and vim.b[buffer].is_pi_terminal ~= true
end

function M.capture_prompt_location()
	local buffer = vim.api.nvim_get_current_buf()
	local mode = vim.api.nvim_get_mode().mode
	local visual = mode == "v" or mode == "V" or mode == string.char(22)
	if not is_source_buffer(buffer, true) then
		return nil, visual and "PI_CONTEXT_UNAVAILABLE" or nil
	end

	local name = vim.api.nvim_buf_get_name(buffer)
	local path = canonical_path(name)
	local cwd = canonical_path(vim.fn.getcwd())
	if not path_is_inside(path, cwd) then
		return nil, "PI_WORKTREE_MISMATCH"
	end
	if #path > 4096 then
		return nil, "PI_CONTEXT_TOO_LARGE"
	end

	local cursor = vim.fn.getpos(".")
	local anchor = visual and vim.fn.getpos("v") or cursor
	local total_lines = vim.api.nvim_buf_line_count(buffer)
	if anchor[2] < 1 or cursor[2] < 1 or anchor[2] > total_lines or cursor[2] > total_lines then
		return nil, "PI_CONTEXT_UNAVAILABLE"
	end
	local selection_modes = { v = "character", V = "line", [string.char(22)] = "block" }
	local first_line, last_line = math.min(anchor[2], cursor[2]), math.max(anchor[2], cursor[2])
	if last_line - first_line >= 500 then
		return nil, "PI_CONTEXT_TOO_LARGE"
	end
	local lines = vim.api.nvim_buf_get_lines(buffer, first_line - 1, last_line, false)
	if #table.concat(lines, "\n") > 16 * 1024 then
		return nil, "PI_CONTEXT_TOO_LARGE"
	end
	return {
		name = name,
		cwd = cwd,
		context = {
			lines = lines,
			path = path,
			buffer = buffer,
			changedtick = vim.api.nvim_buf_get_changedtick(buffer),
			selectionMode = selection_modes[mode] or "cursor",
			selection = vim.o.selection,
			range = {
				anchor = { line = anchor[2], column = anchor[3], offset = anchor[4] },
				cursor = { line = cursor[2], column = cursor[3], offset = cursor[4] },
			},
		},
	}
end

function M.validate_prompt_location(location, cwd)
	if location == nil then
		return nil
	end
	local context = location.context
	if
		not is_source_buffer(context.buffer, true)
		or vim.api.nvim_buf_get_name(context.buffer) ~= location.name
		or canonical_path(location.name) ~= context.path
		or vim.api.nvim_buf_get_changedtick(context.buffer) ~= context.changedtick
	then
		return "PI_CONTEXT_STALE"
	end
	if canonical_path(cwd) ~= location.cwd or canonical_path(vim.fn.getcwd()) ~= location.cwd then
		return "PI_WORKTREE_MISMATCH"
	end
	return nil
end
return M
