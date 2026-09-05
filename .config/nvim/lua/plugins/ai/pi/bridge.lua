local M = {}

local MAX_CONTEXT_LINES = 500
local MAX_CONTEXT_BYTES = 32 * 1024
local MAX_INVENTORY_ITEMS = 500
local MAX_INVENTORY_BYTES = 32 * 1024
local DEFAULT_DIAGNOSTIC_SUMMARY_ITEMS = 20
local MAX_DIAGNOSTIC_SUMMARY_ITEMS = 50
local MAX_DIAGNOSTIC_ITEMS = 500
local MAX_DIAGNOSTIC_SOURCE_ITEMS = 5000
local MAX_DIAGNOSTIC_BYTES = 32 * 1024
local DEFAULT_QUICKFIX_ITEMS = 20
local MAX_QUICKFIX_ITEMS = 50
local MAX_QUICKFIX_SOURCE_ITEMS = 5000
local MAX_QUICKFIX_BYTES = 32 * 1024
local DEFAULT_HIGHLIGHT_DURATION_MS = 2000
local MAX_HIGHLIGHT_DURATION_MS = 30000
local MAX_HIGHLIGHT_LINES = 500
local DEFAULT_ANNOTATION_DURATION_MS = 2000
local MAX_ANNOTATION_DURATION_MS = 30000
local MAX_ANNOTATIONS = 10
local MAX_ANNOTATION_ANCHOR_BYTES = 512
local MAX_ANNOTATION_TEXT_BYTES = 256
local MAX_ANNOTATION_SEARCH_LINES = 1000
local MAX_ANNOTATION_SEARCH_BYTES = 256 * 1024
local MAX_ACTIVE_ANNOTATIONS = 50
local FOCUS_NOTIFICATION = "pi:focus"

local channel_states = {}
local launch_source_context

local function invalid_request()
	return { error = "invalidRequest" }
end

local function positive_integer(value)
	return type(value) == "number" and value >= 1 and value == math.floor(value)
end

local function nonnegative_integer(value)
	return type(value) == "number" and value >= 0 and value == math.floor(value)
end

local function has_uri_scheme(path)
	return type(path) == "string" and path:match("^%a[%w+.-]*:") ~= nil
end

local function has_only_keys(value, keys)
	if type(value) ~= "table" then
		return false
	end
	for key in pairs(value) do
		if keys[key] ~= true then
			return false
		end
	end
	return true
end

local function bounded_value(payload, key, default, maximum)
	local value = payload[key]
	if value == nil then
		return default
	end
	if positive_integer(value) == false or value > maximum then
		return nil
	end
	return value
end

local function copy_value(value)
	if type(value) ~= "table" then
		return value
	end
	local ok, copied = pcall(vim.deepcopy, value)
	return ok and copied or nil
end

local function seed_source_context()
	return copy_value(launch_source_context)
end

function M.record_source_context(context)
	if type(context) ~= "table" then
		return false
	end
	local recorded = copy_value(context)
	if recorded == nil then
		return false
	end
	launch_source_context = recorded
	for _, state in pairs(channel_states) do
		state.source_context = copy_value(recorded)
	end
	return true
end

local function channel_from_rpc(request)
	local channel = type(request) == "table" and request.channelId or nil
	if positive_integer(channel) == false then
		return nil
	end
	-- v:channel is zero for nvim_exec_lua on current Neovim releases; verify it when available.
	local rpc_channel = vim.v.channel
	if positive_integer(rpc_channel) and rpc_channel ~= channel then
		return nil
	end
	return channel
end

local function channel_state(channel)
	local state = channel_states[channel]
	if state ~= nil then
		return state
	end

	state = {
		annotation_batches = {},
		highlights = {},
		source_context = seed_source_context(),
		notification_limits = {
			max_bytes = MAX_CONTEXT_BYTES,
			max_lines = MAX_CONTEXT_LINES,
		},
	}
	channel_states[channel] = state
	return state
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
		and options.filetype ~= "opencode"
		and options.filetype ~= "opencode_terminal"
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
	-- Preserve direction, byte columns and virtual-cell offsets without reading selected text.
	return {
		name = name,
		cwd = cwd,
		context = {
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

local function buffer_info(buffer)
	local options = vim.bo[buffer]
	return {
		number = buffer,
		name = vim.api.nvim_buf_get_name(buffer),
		loaded = vim.api.nvim_buf_is_loaded(buffer),
		filetype = options.filetype,
		buftype = options.buftype,
		modified = options.modified,
	}
end

local function text_bytes(lines)
	local bytes = math.max(0, #lines - 1)
	for _, line in ipairs(lines) do
		bytes = bytes + #line
	end
	return bytes
end

local function selection_snapshot(mode, max_lines, max_bytes)
	if mode ~= "v" and mode ~= "V" and mode ~= string.char(22) then
		return vim.NIL
	end

	local anchor = vim.fn.getpos("v")
	local current = vim.fn.getpos(".")
	local ok, lines = pcall(vim.fn.getregion, anchor, current, { type = mode })
	if ok == false or type(lines) ~= "table" then
		return { limited = true }
	end
	if #lines <= max_lines and text_bytes(lines) <= max_bytes then
		return {
			mode = mode,
			anchor = { line = anchor[2], column = anchor[3] },
			cursor = { line = current[2], column = current[3] },
			lines = lines,
		}
	end
	return { limited = true }
end

local function source_snapshot(max_lines, max_bytes)
	local buffer = vim.api.nvim_get_current_buf()
	local options = vim.bo[buffer]
	local name = vim.api.nvim_buf_get_name(buffer)
	if
		name == ""
		or has_uri_scheme(name)
		or options.buftype ~= ""
		or options.modifiable == false
		or options.filetype == "opencode"
		or options.filetype == "opencode_terminal"
		or vim.b[buffer].is_pi_terminal == true
	then
		return nil
	end

	local cursor = vim.api.nvim_win_get_cursor(0)
	local mode = vim.api.nvim_get_mode().mode
	local selection = vim.NIL
	if mode == "v" or mode == "V" or mode == string.char(22) then
		local anchor = vim.fn.getpos("v")
		local current = vim.fn.getpos(".")
		local ok, lines = pcall(vim.fn.getregion, anchor, current, { type = mode })
		if ok and type(lines) == "table" then
			if #lines <= max_lines and text_bytes(lines) <= max_bytes then
				selection = {
					mode = mode,
					anchor = { line = anchor[2], column = anchor[3] },
					cursor = { line = current[2], column = current[3] },
					lines = lines,
				}
			else
				selection = { limited = true }
			end
		else
			selection = { limited = true }
		end
	end

	return {
		pid = vim.fn.getpid(),
		cwd = vim.fn.getcwd(),
		mode = mode,
		selection = selection,
		buffer = buffer_info(buffer),
		cursor = { line = math.max(cursor[1], 1), column = math.max(cursor[2] + 1, 1) },
	}
end

local function normalize_source_context(state)
	local source = state.source_context
	if type(source) ~= "table" then
		return nil
	end
	if type(source.mode) == "string" then
		return source
	end

	local copied = copy_value(source)
	if type(copied) ~= "table" then
		return nil
	end
	local selection = copied.selection
	copied.mode = type(selection) == "table" and selection.mode or "n"
	state.source_context = copied
	return copied
end

local function context_snapshot(state, max_lines, max_bytes)
	local buffer = vim.api.nvim_get_current_buf()
	if vim.b[buffer].is_pi_terminal == true then
		return normalize_source_context(state)
	end

	local cursor = vim.api.nvim_win_get_cursor(0)
	local mode = vim.api.nvim_get_mode().mode
	local selection = selection_snapshot(mode, max_lines, max_bytes)
	local snapshot = {
		pid = vim.fn.getpid(),
		cwd = vim.fn.getcwd(),
		mode = mode,
		selection = selection,
		buffer = buffer_info(buffer),
		cursor = { line = math.max(cursor[1], 1), column = math.max(cursor[2] + 1, 1) },
	}
	state.source_context = copy_value(snapshot) or snapshot
	return snapshot
end

local function preserved_source_buffer(state)
	local source = normalize_source_context(state)
	if
		type(source) ~= "table"
		or type(source.buffer) ~= "table"
		or positive_integer(source.buffer.number) == false
		or type(source.buffer.name) ~= "string"
	then
		return nil
	end

	local candidate = source.buffer.number
	if is_source_buffer(candidate, true) and vim.api.nvim_buf_get_name(candidate) == source.buffer.name then
		return candidate
	end
	return nil
end

local function active_context(state, payload)
	if not has_only_keys(payload, { maxBytes = true, maxLines = true }) then
		return invalid_request()
	end
	local max_lines = bounded_value(payload, "maxLines", MAX_CONTEXT_LINES, MAX_CONTEXT_LINES)
	local max_bytes = bounded_value(payload, "maxBytes", MAX_CONTEXT_BYTES, MAX_CONTEXT_BYTES)
	if max_lines == nil or max_bytes == nil then
		return invalid_request()
	end
	return context_snapshot(state, max_lines, max_bytes)
end

local function visible_windows(payload)
	if not has_only_keys(payload, { maxBytes = true, maxItems = true }) then
		return invalid_request()
	end
	local max_items = bounded_value(payload, "maxItems", MAX_INVENTORY_ITEMS, MAX_INVENTORY_ITEMS)
	local max_bytes = bounded_value(payload, "maxBytes", MAX_INVENTORY_BYTES, MAX_INVENTORY_BYTES)
	if max_items == nil or max_bytes == nil then
		return invalid_request()
	end

	local windows = {}
	local bytes = 0
	for _, window in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
		local buffer = vim.api.nvim_win_get_buf(window)
		if is_source_buffer(buffer, false) then
			local viewport = vim.fn.getwininfo(window)[1]
			if viewport == nil then
				return { error = "inventoryLimit" }
			end
			local info = buffer_info(buffer)
			if #windows >= max_items then
				return { error = "inventoryLimit" }
			end
			bytes = bytes + #info.name + #info.filetype + #info.buftype + 160
			if bytes > max_bytes then
				return { error = "inventoryLimit" }
			end
			table.insert(windows, {
				number = window,
				buffer = info,
				topLine = viewport.topline,
				bottomLine = viewport.botline,
			})
		end
	end

	table.sort(windows, function(left, right)
		return left.number < right.number
	end)
	return {
		pid = vim.fn.getpid(),
		cwd = vim.fn.getcwd(),
		windows = windows,
	}
end

local function list_buffers(payload)
	if not has_only_keys(payload, { maxBytes = true, maxItems = true }) then
		return invalid_request()
	end
	local max_items = bounded_value(payload, "maxItems", MAX_INVENTORY_ITEMS, MAX_INVENTORY_ITEMS)
	local max_bytes = bounded_value(payload, "maxBytes", MAX_INVENTORY_BYTES, MAX_INVENTORY_BYTES)
	if max_items == nil or max_bytes == nil then
		return invalid_request()
	end

	local buffers = {}
	local bytes = 0
	for _, buffer in ipairs(vim.api.nvim_list_bufs()) do
		if vim.fn.buflisted(buffer) == 1 and is_source_buffer(buffer, false) then
			local info = buffer_info(buffer)
			if #buffers >= max_items then
				return { error = "inventoryLimit" }
			end
			bytes = bytes + #info.name + #info.filetype + #info.buftype + 128
			if bytes > max_bytes then
				return { error = "inventoryLimit" }
			end
			table.insert(buffers, info)
		end
	end

	table.sort(buffers, function(left, right)
		return left.number < right.number
	end)
	return {
		pid = vim.fn.getpid(),
		cwd = vim.fn.getcwd(),
		buffers = buffers,
	}
end

local function read_target(payload)
	local editor_root = canonical_path(vim.fn.getcwd())
	local root = payload.expectedCwd == nil and editor_root or canonical_path(payload.expectedCwd)
	if root == nil or root ~= editor_root then
		return nil, "worktreeMismatch"
	end

	local requested_buffer = payload.buffer
	if requested_buffer ~= nil then
		if positive_integer(requested_buffer) == false or vim.api.nvim_buf_is_valid(requested_buffer) == false then
			return nil, "invalidBuffer"
		end
		if is_source_buffer(requested_buffer, true) == false then
			return nil, "invalidBuffer"
		end
		if path_is_inside(canonical_path(vim.api.nvim_buf_get_name(requested_buffer)), root) == false then
			return nil, "worktreeMismatch"
		end
		return requested_buffer, nil
	end

	local requested_path = payload.path
	if
		type(requested_path) ~= "string"
		or requested_path == ""
		or #requested_path > 4096
		or requested_path:find("\0", 1, true) ~= nil
		or has_uri_scheme(requested_path)
	then
		return nil, "invalidBuffer"
	end
	local target =
		canonical_path(requested_path:sub(1, 1) == "/" and requested_path or vim.fs.joinpath(root, requested_path))
	if path_is_inside(target, root) == false then
		return nil, "worktreeMismatch"
	end

	local matched
	for _, candidate in ipairs(vim.api.nvim_list_bufs()) do
		if is_source_buffer(candidate, true) and canonical_path(vim.api.nvim_buf_get_name(candidate)) == target then
			if matched ~= nil then
				return nil, "invalidBuffer"
			end
			matched = candidate
		end
	end
	return matched, matched == nil and "invalidBuffer" or nil
end

local function open_file_target(payload)
	if not has_only_keys(payload, { expectedCwd = true, path = true }) then
		return nil, "invalidRequest"
	end
	local path = payload.path
	if
		type(path) ~= "string"
		or path:sub(1, 1) ~= "/"
		or #path > 4096
		or path:find("[%z\1-\31\127]") ~= nil
		or path:find("\194[\128-\159]") ~= nil
		or has_uri_scheme(path)
	then
		return nil, "invalidRequest"
	end

	local editor_cwd = canonical_path(vim.fn.getcwd())
	local expected_cwd = canonical_path(payload.expectedCwd)
	if editor_cwd == nil or expected_cwd == nil or editor_cwd ~= expected_cwd then
		return nil, "worktreeMismatch"
	end
	local target = canonical_path(path)
	local stat = target == nil and nil or vim.uv.fs_stat(target)
	if stat == nil or stat.type ~= "file" then
		return nil, "invalidBuffer"
	end
	return target, nil
end

local function source_window(window)
	return vim.api.nvim_win_is_valid(window) and is_source_buffer(vim.api.nvim_win_get_buf(window), true)
end

local function target_buffer(path)
	for _, buffer in ipairs(vim.api.nvim_list_bufs()) do
		if vim.api.nvim_buf_is_valid(buffer) and canonical_path(vim.api.nvim_buf_get_name(buffer)) == path then
			return buffer
		end
	end
	return nil
end

local function open_file(_, payload)
	local path, target_error = open_file_target(payload)
	if path == nil then
		return { error = target_error }
	end

	local buffer = target_buffer(path)
	local windows = vim.api.nvim_tabpage_list_wins(0)
	if buffer ~= nil then
		for _, window in ipairs(windows) do
			if vim.api.nvim_win_get_buf(window) == buffer then
				vim.api.nvim_set_current_win(window)
				return true
			end
		end
	end

	local window
	for _, candidate in ipairs(windows) do
		if source_window(candidate) and vim.bo[vim.api.nvim_win_get_buf(candidate)].modified == false then
			window = candidate
			break
		end
	end

	local created_window
	if window == nil then
		local original_window = vim.api.nvim_get_current_win()
		local ok, split = pcall(vim.api.nvim_open_win, vim.api.nvim_win_get_buf(original_window), false, {
			split = "below",
			win = original_window,
		})
		if ok == false or vim.api.nvim_win_is_valid(split) == false then
			return { error = "invalidWindow" }
		end
		window = split
		created_window = split
	end

	local ok = pcall(vim.api.nvim_win_call, window, function()
		if buffer ~= nil and vim.api.nvim_buf_is_loaded(buffer) then
			vim.api.nvim_win_set_buf(window, buffer)
		else
			vim.api.nvim_cmd({ cmd = "edit", args = { path } }, {})
		end
	end)
	if ok == false then
		if created_window ~= nil and vim.api.nvim_win_is_valid(created_window) then
			pcall(vim.api.nvim_win_close, created_window, false)
		end
		return { error = "invalidWindow" }
	end
	if canonical_path(vim.api.nvim_buf_get_name(vim.api.nvim_win_get_buf(window))) ~= path then
		return { error = "invalidWindow" }
	end
	vim.api.nvim_set_current_win(window)
	return true
end

local function read_buffer(payload)
	if
		not has_only_keys(payload, {
			buffer = true,
			endLine = true,
			expectedCwd = true,
			expectedChangedtick = true,
			expectedPath = true,
			maxBytes = true,
			maxLines = true,
			path = true,
			startLine = true,
		})
	then
		return invalid_request()
	end
	if (payload.buffer == nil) == (payload.path == nil) then
		return invalid_request()
	end

	local buffer, target_error = read_target(payload)
	if buffer == nil then
		return { error = target_error }
	end
	if payload.expectedChangedtick ~= nil then
		if not nonnegative_integer(payload.expectedChangedtick) then
			return invalid_request()
		end
		if vim.api.nvim_buf_get_changedtick(buffer) ~= payload.expectedChangedtick then
			return { error = "contextStale" }
		end
	end
	if payload.expectedPath ~= nil then
		local expected_path = payload.expectedPath
		if
			type(expected_path) ~= "string"
			or #expected_path > 4096
			or expected_path:sub(1, 1) ~= "/"
			or expected_path:find("\0", 1, true) ~= nil
		then
			return invalid_request()
		end
		local expected = canonical_path(expected_path)
		if expected == nil or canonical_path(vim.api.nvim_buf_get_name(buffer)) ~= expected then
			return { error = "contextStale" }
		end
	end

	local requested_start = payload.startLine or 0
	local requested_end = payload.endLine or 0
	if
		(requested_start ~= 0 and positive_integer(requested_start) == false)
		or (requested_end ~= 0 and positive_integer(requested_end) == false)
	then
		return { error = "invalidRange" }
	end
	local max_lines = bounded_value(payload, "maxLines", MAX_CONTEXT_LINES, MAX_CONTEXT_LINES)
	local max_bytes = bounded_value(payload, "maxBytes", MAX_CONTEXT_BYTES, MAX_CONTEXT_BYTES)
	if max_lines == nil or max_bytes == nil then
		return invalid_request()
	end

	local total_lines = vim.api.nvim_buf_line_count(buffer)
	local start_line = requested_start == 0 and 1 or requested_start
	local end_line = requested_end == 0 and math.min(total_lines, start_line + max_lines - 1) or requested_end
	if start_line > total_lines or end_line < start_line or end_line > total_lines then
		return { error = "invalidRange", totalLines = total_lines }
	end
	if end_line - start_line + 1 > max_lines then
		return { error = "lineLimit" }
	end

	local lines = vim.api.nvim_buf_get_lines(buffer, start_line - 1, end_line, true)
	local bytes = text_bytes(lines)
	if bytes > max_bytes then
		return { error = "byteLimit" }
	end
	return {
		pid = vim.fn.getpid(),
		cwd = vim.fn.getcwd(),
		buffer = buffer_info(buffer),
		changedtick = vim.api.nvim_buf_get_changedtick(buffer),
		startLine = start_line,
		endLine = end_line,
		totalLines = total_lines,
		lines = lines,
	}
end

local severity_names = {
	[vim.diagnostic.severity.ERROR] = "error",
	[vim.diagnostic.severity.WARN] = "warning",
	[vim.diagnostic.severity.INFO] = "information",
	[vim.diagnostic.severity.HINT] = "hint",
}
local severity_order = { error = 1, warning = 2, information = 3, hint = 4 }

local function text_before(left, right)
	local shared_length = math.min(#left, #right)
	for index = 1, shared_length do
		local left_byte = string.byte(left, index)
		local right_byte = string.byte(right, index)
		if left_byte ~= right_byte then
			return left_byte < right_byte
		end
	end
	return #left < #right
end

local function diagnostic_before(left, right)
	if left.severity ~= right.severity then
		return severity_order[left.severity] < severity_order[right.severity]
	end
	if left.start.line ~= right.start.line then
		return left.start.line < right.start.line
	end
	if left.start.column ~= right.start.column then
		return left.start.column < right.start.column
	end
	if left["end"].line ~= right["end"].line then
		return left["end"].line < right["end"].line
	end
	if left["end"].column ~= right["end"].column then
		return left["end"].column < right["end"].column
	end
	if left.source ~= right.source then
		return text_before(left.source, right.source)
	end
	return text_before(left.message, right.message)
end

local function retain_diagnostic(diagnostics, diagnostic, summary_items)
	if summary_items == 0 then
		table.insert(diagnostics, diagnostic)
		return
	end

	local insert_at = #diagnostics + 1
	for index, existing in ipairs(diagnostics) do
		if diagnostic_before(diagnostic, existing) then
			insert_at = index
			break
		end
	end
	if insert_at <= summary_items then
		table.insert(diagnostics, insert_at, diagnostic)
		if #diagnostics > summary_items then
			table.remove(diagnostics)
		end
	elseif #diagnostics < summary_items then
		table.insert(diagnostics, diagnostic)
	end
end

local function diagnostics(state, payload, summary)
	if
		not has_only_keys(payload, {
			buffer = true,
			maxBytes = true,
			maxItems = true,
			maxSourceItems = true,
		})
	then
		return invalid_request()
	end

	local requested_buffer = payload.buffer or 0
	local max_items = bounded_value(
		payload,
		"maxItems",
		summary and DEFAULT_DIAGNOSTIC_SUMMARY_ITEMS or MAX_DIAGNOSTIC_ITEMS,
		summary and MAX_DIAGNOSTIC_SUMMARY_ITEMS or MAX_DIAGNOSTIC_ITEMS
	)
	local max_source_items =
		bounded_value(payload, "maxSourceItems", MAX_DIAGNOSTIC_SOURCE_ITEMS, MAX_DIAGNOSTIC_SOURCE_ITEMS)
	local max_bytes = bounded_value(payload, "maxBytes", MAX_DIAGNOSTIC_BYTES, MAX_DIAGNOSTIC_BYTES)
	if max_items == nil or max_source_items == nil or max_bytes == nil then
		return invalid_request()
	end

	local buffer = requested_buffer
	if buffer == 0 then
		buffer = vim.api.nvim_get_current_buf()
		if is_source_buffer(buffer, true) == false then
			buffer = preserved_source_buffer(state) or -1
		end
	end
	if is_source_buffer(buffer, true) == false then
		return { error = "invalidBuffer" }
	end

	local raw_diagnostics = vim.diagnostic.get(buffer)
	if #raw_diagnostics > max_source_items then
		return { error = "diagnosticSourceLimit" }
	end
	if summary == false and #raw_diagnostics > max_items then
		return { error = "diagnosticLimit" }
	end

	local selected = {}
	local counts = { error = 0, warning = 0, information = 0, hint = 0, total = 0 }
	for _, diagnostic in ipairs(raw_diagnostics) do
		local severity = severity_names[diagnostic.severity or vim.diagnostic.severity.ERROR]
		local end_line = diagnostic.end_lnum or diagnostic.lnum
		local end_column = diagnostic.end_col or diagnostic.col
		local source = diagnostic.source or ""
		if
			severity == nil
			or nonnegative_integer(diagnostic.lnum) == false
			or nonnegative_integer(diagnostic.col) == false
			or nonnegative_integer(end_line) == false
			or nonnegative_integer(end_column) == false
			or end_line < diagnostic.lnum
			or (end_line == diagnostic.lnum and end_column < diagnostic.col)
			or type(diagnostic.message) ~= "string"
			or type(source) ~= "string"
		then
			return { error = "invalidDiagnostics" }
		end

		counts[severity] = counts[severity] + 1
		retain_diagnostic(selected, {
			start = { line = diagnostic.lnum + 1, column = diagnostic.col + 1 },
			["end"] = { line = end_line + 1, column = end_column + 1 },
			severity = severity,
			message = diagnostic.message,
			source = source,
		}, summary and max_items or 0)
	end
	counts.total = #raw_diagnostics
	if summary == false then
		table.sort(selected, diagnostic_before)
	end

	local info = buffer_info(buffer)
	local bytes = #info.name + #info.filetype + #info.buftype + 512
	for _, diagnostic in ipairs(selected) do
		bytes = bytes + #diagnostic.message + #diagnostic.source + 128
		if bytes > max_bytes then
			return { error = "diagnosticLimit" }
		end
	end

	return {
		pid = vim.fn.getpid(),
		cwd = vim.fn.getcwd(),
		buffer = info,
		counts = counts,
		diagnostics = selected,
		truncated = #selected < counts.total,
	}
end

local function problem_source_buffer(buffer)
	if positive_integer(buffer) == false or vim.api.nvim_buf_is_valid(buffer) == false then
		return false
	end
	local options = vim.bo[buffer]
	local name = vim.api.nvim_buf_get_name(buffer)
	return name ~= ""
		and has_uri_scheme(name) == false
		and options.buftype == ""
		and options.filetype ~= "opencode"
		and options.filetype ~= "opencode_terminal"
		and vim.b[buffer].is_pi_terminal ~= true
end

local function quickfix(payload)
	if
		not has_only_keys(payload, {
			kind = true,
			maxBytes = true,
			maxItems = true,
			maxSourceItems = true,
			window = true,
		})
	then
		return invalid_request()
	end

	local kind = payload.kind or "quickfix"
	if kind ~= "quickfix" and kind ~= "location" then
		return invalid_request()
	end
	if kind == "quickfix" and payload.window ~= nil then
		return invalid_request()
	end
	local requested_window = payload.window or 0
	if
		kind == "location"
		and (positive_integer(requested_window) == false or vim.api.nvim_win_is_valid(requested_window) == false)
	then
		return { error = "invalidWindow" }
	end

	local max_items = bounded_value(payload, "maxItems", DEFAULT_QUICKFIX_ITEMS, MAX_QUICKFIX_ITEMS)
	local max_source_items =
		bounded_value(payload, "maxSourceItems", MAX_QUICKFIX_SOURCE_ITEMS, MAX_QUICKFIX_SOURCE_ITEMS)
	local max_bytes = bounded_value(payload, "maxBytes", MAX_QUICKFIX_BYTES, MAX_QUICKFIX_BYTES)
	if max_items == nil or max_source_items == nil or max_bytes == nil then
		return invalid_request()
	end

	local info
	local owner
	if kind == "location" then
		info = vim.fn.getloclist(requested_window, { id = 0, size = 0, title = 1 })
		owner = { kind = "location", listId = info.id or 0, window = requested_window }
	else
		info = vim.fn.getqflist({ id = 0, size = 0, title = 1 })
		owner = { kind = "quickfix", listId = info.id or 0 }
	end

	local total = info.size or 0
	if total > max_source_items then
		return { error = "sourceLimit" }
	end
	local title = info.title or ""
	if type(title) ~= "string" or #title + 256 > max_bytes then
		return { error = "contentLimit" }
	end

	local list = kind == "location" and vim.fn.getloclist(requested_window, { items = 1 })
		or vim.fn.getqflist({ items = 1 })
	local raw_items = list.items or {}
	local items = {}
	for index = 1, math.min(max_items, total) do
		local item = raw_items[index]
		if type(item) ~= "table" then
			return { error = "invalidSource" }
		end
		local buffer = item.bufnr or 0
		local filename = item.filename or ""
		if buffer > 0 and vim.api.nvim_buf_is_valid(buffer) then
			if problem_source_buffer(buffer) == false then
				return { error = "invalidSource" }
			end
			filename = vim.api.nvim_buf_get_name(buffer)
		end
		table.insert(items, {
			buffer = buffer,
			filename = filename,
			line = item.lnum or 0,
			column = item.col or 0,
			endLine = item.end_lnum or 0,
			endColumn = item.end_col or 0,
			text = item.text or "",
			type = item.type or "",
			valid = item.valid == 1,
		})
	end

	local result = {
		pid = vim.fn.getpid(),
		cwd = vim.fn.getcwd(),
		owner = owner,
		title = title,
		total = total,
		items = items,
		truncated = #items < total,
	}
	local ok, encoded = pcall(vim.json.encode, result)
	if ok == false or #encoded > max_bytes then
		return { error = "contentLimit" }
	end
	return result
end

local function worktree_target(buffer, expected_cwd)
	if
		positive_integer(buffer) == false
		or vim.api.nvim_buf_is_valid(buffer) == false
		or vim.api.nvim_buf_is_loaded(buffer) == false
	then
		return nil, "invalidBuffer"
	end
	if type(expected_cwd) ~= "string" or expected_cwd == "" then
		return nil, "worktreeMismatch"
	end

	local editor_cwd = vim.fn.getcwd()
	local root = canonical_path(expected_cwd)
	if root == nil or canonical_path(editor_cwd) ~= root then
		return nil, "worktreeMismatch"
	end

	local name = vim.api.nvim_buf_get_name(buffer)
	local target = canonical_path(name)
	if target == nil then
		return nil, "invalidBuffer"
	end
	if path_is_inside(target, root) == false then
		return nil, "worktreeMismatch"
	end
	if is_source_buffer(buffer, true) == false then
		return nil, "invalidBuffer"
	end
	return { editor_cwd = editor_cwd, name = name, root = root }, nil
end

local function reveal(state, payload)
	if
		not has_only_keys(payload, {
			buffer = true,
			column = true,
			expectedCwd = true,
			focus = true,
			line = true,
			split = true,
		})
	then
		return invalid_request()
	end

	local buffer = payload.buffer
	local line = payload.line
	local column = payload.column
	local focus = payload.focus
	if focus == nil then
		focus = false
	end
	local split = payload.split
	if split == nil then
		split = "none"
	end
	if
		positive_integer(buffer) == false
		or vim.api.nvim_buf_is_valid(buffer) == false
		or vim.api.nvim_buf_is_loaded(buffer) == false
	then
		return { error = "invalidBuffer" }
	end
	if positive_integer(line) == false or positive_integer(column) == false then
		return { error = "invalidPosition" }
	end
	if type(focus) ~= "boolean" or (split ~= "none" and split ~= "horizontal" and split ~= "vertical") then
		return invalid_request()
	end

	local target, target_error = worktree_target(buffer, payload.expectedCwd)
	if target == nil then
		return { error = target_error }
	end
	local total_lines = vim.api.nvim_buf_line_count(buffer)
	if line > total_lines then
		return { error = "invalidPosition", totalLines = total_lines }
	end
	local source_line = vim.api.nvim_buf_get_lines(buffer, line - 1, line, true)[1]
	if column > #source_line + 1 then
		return { error = "invalidPosition", totalLines = total_lines }
	end

	local function is_source_window(window)
		return vim.api.nvim_win_is_valid(window)
			and is_source_buffer(vim.api.nvim_win_get_buf(window), true)
			and path_is_inside(canonical_path(vim.api.nvim_buf_get_name(vim.api.nvim_win_get_buf(window))), target.root)
	end

	local windows = vim.api.nvim_tabpage_list_wins(0)
	local window
	for _, candidate in ipairs(windows) do
		if vim.api.nvim_win_get_buf(candidate) == buffer then
			window = candidate
			break
		end
	end
	if window == nil then
		local recent = normalize_source_context(state)
		if type(recent) == "table" and type(recent.buffer) == "table" and positive_integer(recent.buffer.number) then
			for _, candidate in ipairs(windows) do
				if vim.api.nvim_win_get_buf(candidate) == recent.buffer.number and is_source_window(candidate) then
					window = candidate
					break
				end
			end
		end
	end
	if window == nil then
		for _, candidate in ipairs(windows) do
			if is_source_window(candidate) then
				window = candidate
				break
			end
		end
	end
	if window == nil then
		return { error = "missingSourceWindow" }
	end

	local original_window = vim.api.nvim_get_current_win()
	local previous_buffer = vim.api.nvim_win_get_buf(window)
	local previous_cursor = vim.api.nvim_win_get_cursor(window)
	local previous_eventignore = vim.o.eventignore
	vim.o.eventignore = "all"
	local view_ok, previous_view = pcall(vim.api.nvim_win_call, window, function()
		return vim.fn.winsaveview()
	end)
	if view_ok == false then
		vim.o.eventignore = previous_eventignore
		return { error = "invalidWindow" }
	end

	local created_window
	local window_changed = false
	local function set_buffer_without_autocmd(target_window, target_buffer)
		vim.api.nvim_win_call(target_window, function()
			vim.api.nvim_cmd({ cmd = "buffer", args = { tostring(target_buffer) }, mods = { noautocmd = true } }, {})
		end)
	end
	local function restore_focus()
		if vim.api.nvim_win_is_valid(original_window) and vim.api.nvim_get_current_win() ~= original_window then
			pcall(vim.api.nvim_set_current_win, original_window)
		end
	end
	local function rollback()
		if created_window ~= nil and vim.api.nvim_win_is_valid(created_window) then
			pcall(vim.api.nvim_win_close, created_window, true)
		elseif window_changed and vim.api.nvim_win_is_valid(window) then
			pcall(set_buffer_without_autocmd, window, previous_buffer)
			pcall(vim.api.nvim_win_set_cursor, window, previous_cursor)
			pcall(vim.api.nvim_win_call, window, function()
				vim.fn.winrestview(previous_view)
			end)
		end
		restore_focus()
		vim.o.eventignore = previous_eventignore
	end

	local operation_ok = pcall(function()
		if split == "none" then
			window_changed = true
			set_buffer_without_autocmd(window, buffer)
		else
			local direction = split == "horizontal" and "below" or "right"
			window = vim.api.nvim_open_win(buffer, false, {
				split = direction,
				win = window,
				noautocmd = true,
			})
			if window == 0 or vim.api.nvim_win_is_valid(window) == false then
				error("split failed")
			end
			created_window = window
		end
		vim.api.nvim_win_set_cursor(window, { line, column - 1 })
		vim.api.nvim_win_call(window, function()
			vim.api.nvim_cmd({ cmd = "normal", args = { "zz" }, bang = true, mods = { noautocmd = true } }, {})
		end)
		if focus then
			vim.api.nvim_set_current_win(window)
		end
	end)
	if operation_ok == false then
		rollback()
		return { error = "invalidWindow" }
	end

	if focus == false and vim.api.nvim_get_current_win() ~= original_window then
		restore_focus()
	end
	local observed_ok, observed = pcall(function()
		return {
			currentWindow = vim.api.nvim_get_current_win(),
			cursor = vim.api.nvim_win_get_cursor(window),
			buffer = vim.api.nvim_win_get_buf(window),
			direction = created_window ~= nil and vim.api.nvim_win_get_config(window).split or "",
		}
	end)
	if observed_ok == false then
		rollback()
		return { error = "invalidWindow" }
	end

	local actual_split = "none"
	if observed.direction == "below" then
		actual_split = "horizontal"
	elseif observed.direction == "right" then
		actual_split = "vertical"
	elseif created_window ~= nil then
		rollback()
		return { error = "invalidWindow" }
	end
	if
		observed.buffer ~= buffer
		or observed.cursor[1] ~= line
		or observed.cursor[2] + 1 ~= column
		or actual_split ~= split
		or (focus and observed.currentWindow ~= window)
		or (focus == false and observed.currentWindow ~= original_window)
	then
		rollback()
		return { error = "invalidWindow" }
	end

	vim.o.eventignore = previous_eventignore
	local info = buffer_info(buffer)
	return {
		pid = vim.fn.getpid(),
		cwd = target.editor_cwd,
		buffer = info,
		window = window,
		position = { line = observed.cursor[1], column = observed.cursor[2] + 1 },
		focused = observed.currentWindow == window,
		focusPreserved = observed.currentWindow == original_window,
		split = actual_split,
		splitCreated = created_window ~= nil,
	}
end

local function valid_text(value, maximum, allow_tab)
	if type(value) ~= "string" or value == "" or #value > maximum then
		return false
	end
	if value:find(string.char(0), 1, true) ~= nil then
		return false
	end
	if allow_tab == false and value:match("^%s*$") ~= nil then
		return false
	end
	for index = 1, #value do
		local byte = value:byte(index)
		if byte == 127 or byte == 10 or byte == 13 or (allow_tab == false and byte < 32) then
			return false
		end
	end
	return true
end

local function find_unique(source, anchor)
	local first = source:find(anchor, 1, true)
	if first == nil then
		return nil, false
	end
	return first, source:find(anchor, first + 1, true) ~= nil
end

local function annotation_source_lines(buffer, total_lines, max_search_lines, max_search_bytes)
	if total_lines > max_search_lines then
		return nil
	end
	local offset_ok, total_bytes = pcall(vim.api.nvim_buf_get_offset, buffer, total_lines)
	if offset_ok == false or total_bytes < 0 or total_bytes > max_search_bytes then
		return nil
	end
	local lines_ok, lines = pcall(vim.api.nvim_buf_get_lines, buffer, 0, -1, true)
	if lines_ok == false or type(lines) ~= "table" then
		return nil
	end
	return lines
end

local function resolve_annotation(
	buffer,
	total_lines,
	annotation,
	input_index,
	max_anchor_bytes,
	max_text_bytes,
	max_search_lines,
	max_search_bytes
)
	if
		not has_only_keys(annotation, { anchor = true, kind = true, line = true, text = true })
		or positive_integer(annotation.line) == false
		or valid_text(annotation.anchor, max_anchor_bytes, true) == false
		or valid_text(annotation.text, max_text_bytes, false) == false
		or (annotation.kind ~= "note" and annotation.kind ~= "warning" and annotation.kind ~= "error")
	then
		return nil, "invalidAnnotation"
	end

	if annotation.line <= total_lines then
		local source = vim.api.nvim_buf_get_lines(buffer, annotation.line - 1, annotation.line, true)[1]
		local column, ambiguous = find_unique(source, annotation.anchor)
		if ambiguous then
			return nil, "ambiguousAnchor"
		end
		if column ~= nil then
			return {
				column = column,
				inputIndex = input_index,
				kind = annotation.kind,
				line = annotation.line,
				sourceLineBytes = #source,
				text = annotation.text,
			}
		end
	end

	local lines = annotation_source_lines(buffer, total_lines, max_search_lines, max_search_bytes)
	if lines == nil then
		return nil, "searchLimit"
	end
	local match
	for line, source in ipairs(lines) do
		local column, ambiguous = find_unique(source, annotation.anchor)
		if ambiguous or (column ~= nil and match ~= nil) then
			return nil, "ambiguousAnchor"
		end
		if column ~= nil then
			match = {
				column = column,
				inputIndex = input_index,
				kind = annotation.kind,
				line = line,
				sourceLineBytes = #source,
				text = annotation.text,
			}
		end
	end
	if match == nil then
		return nil, "staleAnchor"
	end
	return match
end

local function extmark_exists(buffer, namespace, id)
	local ok, position = pcall(vim.api.nvim_buf_get_extmark_by_id, buffer, namespace, id, {})
	return ok and type(position) == "table" and #position > 0
end

local function delete_extmarks(buffer, namespace, ids)
	if vim.api.nvim_buf_is_valid(buffer) == false then
		return false
	end
	local clean = true
	for _, id in ipairs(ids) do
		local delete_ok, deleted = pcall(vim.api.nvim_buf_del_extmark, buffer, namespace, id)
		if delete_ok == false or deleted ~= true then
			if extmark_exists(buffer, namespace, id) then
				clean = false
			end
		end
	end
	return clean
end

local function valid_timer(timer)
	return (type(timer) == "number" and timer > 0) or type(timer) == "userdata"
end

local function stop_timer(timer)
	if type(timer) == "number" and timer > 0 then
		pcall(vim.fn.timer_stop, timer)
		return
	end
	if type(timer) ~= "userdata" then
		return
	end
	pcall(function()
		timer:stop()
		if timer:is_closing() == false then
			timer:close()
		end
	end)
end

local function annotation_namespace(channel)
	return vim.api.nvim_create_namespace("PiNeovimAnnotations" .. channel)
end

local function annotate(state, channel, payload)
	if
		not has_only_keys(payload, {
			annotations = true,
			batchId = true,
			buffer = true,
			durationMs = true,
			expectedCwd = true,
			maxActiveAnnotations = true,
			maxAnchorBytes = true,
			maxAnnotations = true,
			maxDurationMs = true,
			maxSearchBytes = true,
			maxSearchLines = true,
			maxTextBytes = true,
		})
	then
		return invalid_request()
	end

	local buffer = payload.buffer
	local target, target_error = worktree_target(buffer, payload.expectedCwd)
	if target == nil then
		return { error = target_error }
	end

	local annotations = payload.annotations
	local max_annotations = bounded_value(payload, "maxAnnotations", MAX_ANNOTATIONS, MAX_ANNOTATIONS)
	if type(annotations) ~= "table" or #annotations < 1 or max_annotations == nil or #annotations > max_annotations then
		return { error = "annotationLimit" }
	end

	local duration_ms = payload.durationMs or DEFAULT_ANNOTATION_DURATION_MS
	local max_duration_ms =
		bounded_value(payload, "maxDurationMs", MAX_ANNOTATION_DURATION_MS, MAX_ANNOTATION_DURATION_MS)
	local max_anchor_bytes =
		bounded_value(payload, "maxAnchorBytes", MAX_ANNOTATION_ANCHOR_BYTES, MAX_ANNOTATION_ANCHOR_BYTES)
	local max_text_bytes = bounded_value(payload, "maxTextBytes", MAX_ANNOTATION_TEXT_BYTES, MAX_ANNOTATION_TEXT_BYTES)
	local max_search_lines =
		bounded_value(payload, "maxSearchLines", MAX_ANNOTATION_SEARCH_LINES, MAX_ANNOTATION_SEARCH_LINES)
	local max_search_bytes =
		bounded_value(payload, "maxSearchBytes", MAX_ANNOTATION_SEARCH_BYTES, MAX_ANNOTATION_SEARCH_BYTES)
	local max_active_annotations =
		bounded_value(payload, "maxActiveAnnotations", MAX_ACTIVE_ANNOTATIONS, MAX_ACTIVE_ANNOTATIONS)
	if
		positive_integer(duration_ms) == false
		or max_duration_ms == nil
		or max_anchor_bytes == nil
		or max_text_bytes == nil
		or max_search_lines == nil
		or max_search_bytes == nil
		or max_active_annotations == nil
	then
		return { error = "invalidAnnotation" }
	end
	if duration_ms > max_duration_ms then
		return { error = "durationLimit" }
	end
	if positive_integer(payload.batchId) == false then
		return { error = "invalidAnnotation" }
	end

	local total_lines = vim.api.nvim_buf_line_count(buffer)
	local resolved = {}
	for index, annotation in ipairs(annotations) do
		local item, resolve_error = resolve_annotation(
			buffer,
			total_lines,
			annotation,
			index,
			max_anchor_bytes,
			max_text_bytes,
			max_search_lines,
			max_search_bytes
		)
		if item == nil then
			local requested_line = type(annotation) == "table" and annotation.line or 0
			return { error = resolve_error, annotationIndex = index, requestedLine = requested_line }
		end
		table.insert(resolved, item)
	end

	table.sort(resolved, function(left, right)
		if left.line ~= right.line then
			return left.line < right.line
		end
		if left.column ~= right.column then
			return left.column < right.column
		end
		return left.inputIndex < right.inputIndex
	end)

	local batch_id = payload.batchId
	if state.annotation_batches[batch_id] ~= nil then
		return { error = "invalidAnnotation" }
	end
	local active_annotations = 0
	for _, batch in pairs(state.annotation_batches) do
		if type(batch) == "table" and type(batch.ids) == "table" then
			active_annotations = active_annotations + #batch.ids
		end
	end
	if active_annotations + #resolved > max_active_annotations then
		return { error = "activeLimit" }
	end

	local namespace_ok, namespace = pcall(annotation_namespace, channel)
	if namespace_ok == false then
		return { error = "extmarkFailure" }
	end
	local ids = {}
	local groups = {
		note = "DiagnosticInfo",
		warning = "DiagnosticWarn",
		error = "DiagnosticError",
	}
	local function rollback()
		local clean = delete_extmarks(buffer, namespace, ids)
		if clean then
			state.annotation_batches[batch_id] = nil
		else
			state.annotation_batches[batch_id] = {
				buffer = buffer,
				ids = ids,
				namespace = namespace,
			}
		end
	end

	for _, annotation in ipairs(resolved) do
		local mark_ok, id =
			pcall(vim.api.nvim_buf_set_extmark, buffer, namespace, annotation.line - 1, annotation.column - 1, {
				priority = 200,
				strict = true,
				virt_lines = {
					{
						{ "└──── ", groups[annotation.kind] },
						{ annotation.text, groups[annotation.kind] },
					},
				},
				virt_lines_above = false,
				virt_lines_overflow = "scroll",
			})
		if mark_ok == false or positive_integer(id) == false then
			rollback()
			return { error = "extmarkFailure" }
		end
		table.insert(ids, id)
		local observed_ok, observed = pcall(vim.api.nvim_buf_get_extmark_by_id, buffer, namespace, id, {})
		if
			observed_ok == false
			or type(observed) ~= "table"
			or #observed < 2
			or observed[1] ~= annotation.line - 1
			or observed[2] ~= annotation.column - 1
		then
			rollback()
			return { error = "extmarkFailure" }
		end
		annotation.annotationId = id
		annotation.placement = "callout"
	end

	state.annotation_batches[batch_id] = {
		buffer = buffer,
		ids = ids,
		namespace = namespace,
	}
	local timer_ok, timer = pcall(vim.defer_fn, function()
		local batch = state.annotation_batches[batch_id]
		if type(batch) ~= "table" then
			return
		end
		if delete_extmarks(batch.buffer, batch.namespace, batch.ids) then
			state.annotation_batches[batch_id] = nil
		end
	end, duration_ms)
	if timer_ok == false or valid_timer(timer) == false then
		rollback()
		return { error = "extmarkFailure" }
	end
	state.annotation_batches[batch_id].timer = timer

	local response_annotations = {}
	for _, annotation in ipairs(resolved) do
		table.insert(response_annotations, {
			annotationId = annotation.annotationId,
			column = annotation.column,
			inputIndex = annotation.inputIndex,
			kind = annotation.kind,
			line = annotation.line,
			placement = annotation.placement,
			sourceLineBytes = annotation.sourceLineBytes,
			text = annotation.text,
		})
	end
	return {
		pid = vim.fn.getpid(),
		cwd = target.editor_cwd,
		batchId = batch_id,
		buffer = buffer_info(buffer),
		annotations = response_annotations,
		expiresInMs = duration_ms,
		totalLines = total_lines,
	}
end

local function delete_annotations(state, payload)
	if not has_only_keys(payload, { batchId = true, buffer = true }) then
		return invalid_request()
	end
	if positive_integer(payload.buffer) == false or positive_integer(payload.batchId) == false then
		return false
	end

	local batch = state.annotation_batches[payload.batchId]
	if
		type(batch) ~= "table"
		or batch.buffer ~= payload.buffer
		or type(batch.ids) ~= "table"
		or type(batch.namespace) ~= "number"
	then
		return false
	end
	local clean = delete_extmarks(batch.buffer, batch.namespace, batch.ids)
	if clean then
		stop_timer(batch.timer)
		state.annotation_batches[payload.batchId] = nil
	end
	return clean
end

local function highlight_namespace(channel)
	return vim.api.nvim_create_namespace("PiNeovimHighlights" .. channel)
end

local function highlight_key(buffer, id)
	return string.format("%d:%d", buffer, id)
end

local function remove_highlight(state, key, record)
	local clean = delete_extmarks(record.buffer, record.namespace, { record.id })
	if clean then
		stop_timer(record.timer)
		state.highlights[key] = nil
	end
	return clean
end

local function highlight(state, channel, payload)
	if
		not has_only_keys(payload, {
			buffer = true,
			durationMs = true,
			endColumn = true,
			endLine = true,
			expectedCwd = true,
			maxDurationMs = true,
			maxLines = true,
			startColumn = true,
			startLine = true,
		})
	then
		return invalid_request()
	end

	local start_line = payload.startLine
	local start_column = payload.startColumn or 1
	local end_line = payload.endLine or start_line
	local end_column = payload.endColumn
	local duration_ms = payload.durationMs or DEFAULT_HIGHLIGHT_DURATION_MS
	local max_lines = bounded_value(payload, "maxLines", MAX_HIGHLIGHT_LINES, MAX_HIGHLIGHT_LINES)
	local max_duration_ms =
		bounded_value(payload, "maxDurationMs", MAX_HIGHLIGHT_DURATION_MS, MAX_HIGHLIGHT_DURATION_MS)
	if
		positive_integer(payload.buffer) == false
		or vim.api.nvim_buf_is_valid(payload.buffer) == false
		or vim.api.nvim_buf_is_loaded(payload.buffer) == false
	then
		return { error = "invalidBuffer" }
	end
	if
		positive_integer(start_line) == false
		or positive_integer(start_column) == false
		or positive_integer(end_line) == false
		or end_line < start_line
		or (end_column ~= nil and end_column ~= 0 and positive_integer(end_column) == false)
		or positive_integer(duration_ms) == false
		or max_lines == nil
		or max_duration_ms == nil
	then
		return { error = "invalidRange" }
	end
	if duration_ms > max_duration_ms then
		return { error = "durationLimit" }
	end

	local target, target_error = worktree_target(payload.buffer, payload.expectedCwd)
	if target == nil then
		return { error = target_error }
	end

	local total_lines = vim.api.nvim_buf_line_count(payload.buffer)
	if start_line > total_lines or end_line > total_lines or end_line < start_line then
		return { error = "invalidRange", totalLines = total_lines }
	end
	if end_line - start_line + 1 > max_lines then
		return { error = "lineLimit" }
	end
	local start_text = vim.api.nvim_buf_get_lines(payload.buffer, start_line - 1, start_line, true)[1]
	local end_text = vim.api.nvim_buf_get_lines(payload.buffer, end_line - 1, end_line, true)[1]
	if end_column == nil or end_column == 0 then
		end_column = #end_text + 1
	end
	if start_column > #start_text + 1 or end_column > #end_text + 1 then
		return { error = "invalidColumn", totalLines = total_lines }
	end
	if end_line == start_line and end_column <= start_column then
		return { error = "invalidRange", totalLines = total_lines }
	end

	local namespace_ok, namespace = pcall(highlight_namespace, channel)
	if namespace_ok == false then
		return { error = "extmarkFailure" }
	end
	local mark_ok, id =
		pcall(vim.api.nvim_buf_set_extmark, payload.buffer, namespace, start_line - 1, start_column - 1, {
			end_row = end_line - 1,
			end_col = end_column - 1,
			hl_group = "Search",
			hl_mode = "combine",
			priority = 200,
			strict = true,
		})
	if mark_ok == false or positive_integer(id) == false then
		return { error = "extmarkFailure" }
	end

	local observed_ok, mark = pcall(vim.api.nvim_buf_get_extmark_by_id, payload.buffer, namespace, id, {
		details = true,
		hl_name = true,
	})
	if
		observed_ok == false
		or type(mark) ~= "table"
		or #mark < 3
		or mark[1] ~= start_line - 1
		or mark[2] ~= start_column - 1
		or mark[3].end_row ~= end_line - 1
		or mark[3].end_col ~= end_column - 1
		or mark[3].hl_group ~= "Search"
	then
		pcall(vim.api.nvim_buf_del_extmark, payload.buffer, namespace, id)
		return { error = "extmarkFailure" }
	end

	local key = highlight_key(payload.buffer, id)
	local timer_ok, timer = pcall(vim.defer_fn, function()
		local record = state.highlights[key]
		if type(record) ~= "table" then
			return
		end
		if vim.api.nvim_buf_is_valid(record.buffer) then
			pcall(vim.api.nvim_buf_del_extmark, record.buffer, record.namespace, record.id)
		end
		state.highlights[key] = nil
	end, duration_ms)
	if timer_ok == false or valid_timer(timer) == false then
		pcall(vim.api.nvim_buf_del_extmark, payload.buffer, namespace, id)
		return { error = "extmarkFailure" }
	end
	state.highlights[key] = {
		buffer = payload.buffer,
		id = id,
		namespace = namespace,
		timer = timer,
	}

	return {
		pid = vim.fn.getpid(),
		cwd = target.editor_cwd,
		buffer = buffer_info(payload.buffer),
		highlightId = id,
		start = { line = mark[1] + 1, column = mark[2] + 1 },
		["end"] = { line = mark[3].end_row + 1, column = mark[3].end_col + 1 },
		expiresInMs = duration_ms,
	}
end

local function clear_highlight(state, payload)
	if not has_only_keys(payload, {
		buffer = true,
		expectedCwd = true,
		highlightId = true,
	}) then
		return invalid_request()
	end
	if
		positive_integer(payload.buffer) == false
		or vim.api.nvim_buf_is_valid(payload.buffer) == false
		or vim.api.nvim_buf_is_loaded(payload.buffer) == false
	then
		return { error = "invalidBuffer" }
	end
	if positive_integer(payload.highlightId) == false then
		return { error = "invalidRange" }
	end
	local target, target_error = worktree_target(payload.buffer, payload.expectedCwd)
	if target == nil then
		return { error = target_error }
	end

	local key = highlight_key(payload.buffer, payload.highlightId)
	local record = state.highlights[key]
	local cleared = false
	if type(record) == "table" then
		cleared = remove_highlight(state, key, record)
	end
	return {
		pid = vim.fn.getpid(),
		cwd = target.editor_cwd,
		buffer = buffer_info(payload.buffer),
		highlightId = payload.highlightId,
		cleared = cleared,
	}
end

local function delete_highlight(state, payload)
	if not has_only_keys(payload, { buffer = true, highlightId = true }) then
		return invalid_request()
	end
	if
		positive_integer(payload.buffer) == false
		or positive_integer(payload.highlightId) == false
		or vim.api.nvim_buf_is_valid(payload.buffer) == false
	then
		return false
	end
	local key = highlight_key(payload.buffer, payload.highlightId)
	local record = state.highlights[key]
	if type(record) ~= "table" then
		return false
	end
	return remove_highlight(state, key, record)
end

local function source_focus_notification(state, channel)
	local snapshot = source_snapshot(state.notification_limits.max_lines, state.notification_limits.max_bytes)
	if snapshot ~= nil then
		state.source_context = copy_value(snapshot) or snapshot
	else
		snapshot = normalize_source_context(state)
	end
	if type(snapshot) == "table" then
		pcall(vim.rpcnotify, channel, FOCUS_NOTIFICATION, snapshot)
	end
end

local function install_notifications(state, channel, payload)
	if not has_only_keys(payload, { maxBytes = true, maxLines = true }) then
		return invalid_request()
	end
	local max_lines = bounded_value(payload, "maxLines", MAX_CONTEXT_LINES, MAX_CONTEXT_LINES)
	local max_bytes = bounded_value(payload, "maxBytes", MAX_CONTEXT_BYTES, MAX_CONTEXT_BYTES)
	if max_lines == nil or max_bytes == nil then
		return invalid_request()
	end
	state.notification_limits = { max_bytes = max_bytes, max_lines = max_lines }

	local group_name = "PiNeovimBridge" .. channel
	local group = vim.api.nvim_create_augroup(group_name, { clear = true })
	vim.api.nvim_create_autocmd({
		"BufEnter",
		"BufLeave",
		"BufModifiedSet",
		"CursorMoved",
		"CursorMovedI",
		"ModeChanged",
		"WinEnter",
		"WinLeave",
	}, {
		group = group,
		callback = function()
			source_focus_notification(state, channel)
		end,
	})
	source_focus_notification(state, channel)
	return { pid = vim.fn.getpid(), cwd = vim.fn.getcwd(), channelId = channel }
end

local function remove_notifications(state, channel, payload)
	if not has_only_keys(payload, {}) then
		return invalid_request()
	end
	pcall(vim.api.nvim_del_augroup_by_name, "PiNeovimBridge" .. channel)

	for _, batch in pairs(state.annotation_batches) do
		if type(batch) == "table" then
			stop_timer(batch.timer)
			if type(batch.buffer) == "number" and type(batch.namespace) == "number" then
				delete_extmarks(batch.buffer, batch.namespace, batch.ids or {})
			end
		end
	end
	for _, record in pairs(state.highlights) do
		if type(record) == "table" then
			stop_timer(record.timer)
			if
				type(record.buffer) == "number"
				and type(record.id) == "number"
				and type(record.namespace) == "number"
			then
				delete_extmarks(record.buffer, record.namespace, { record.id })
			end
		end
	end

	local namespaces = vim.api.nvim_get_namespaces()
	for _, name in ipairs({
		"PiNeovimAnnotations" .. channel,
		"PiNeovimHighlights" .. channel,
	}) do
		local namespace = namespaces[name]
		if namespace ~= nil then
			for _, buffer in ipairs(vim.api.nvim_list_bufs()) do
				if vim.api.nvim_buf_is_valid(buffer) then
					pcall(vim.api.nvim_buf_clear_namespace, buffer, namespace, 0, -1)
				end
			end
		end
	end

	state.annotation_batches = {}
	state.highlights = {}
	state.source_context = nil
	local ok, integration = pcall(require, "plugins.ai.pi")
	if ok and type(integration.prompt_channel_closed) == "function" then
		integration.prompt_channel_closed(channel)
	end
	channel_states[channel] = nil
	return true
end

local function bind_session(channel, payload)
	if not has_only_keys(payload, { launchId = true, replacePending = true, sessionId = true }) then
		return invalid_request()
	end
	local session_id = payload.sessionId
	if type(session_id) ~= "string" or #session_id > 128 then
		return invalid_request()
	end
	local single_character = session_id:match("^[A-Za-z0-9]$") ~= nil
	local multiple_characters = session_id:match("^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$") ~= nil
	if single_character == false and multiple_characters == false then
		return invalid_request()
	end
	if payload.replacePending ~= nil and type(payload.replacePending) ~= "boolean" then
		return invalid_request()
	end
	if
		payload.launchId ~= nil
		and (
			type(payload.launchId) ~= "string"
			or #payload.launchId ~= 32
			or payload.launchId:match("^[a-f0-9]+$") == nil
		)
	then
		return invalid_request()
	end

	local ok, integration = pcall(require, "plugins.ai.pi")
	if ok == false or type(integration.bind_session) ~= "function" then
		return false
	end
	local binding = payload.launchId == nil and session_id
		or {
			sessionId = session_id,
			launchId = payload.launchId,
			channelId = channel,
			cwd = vim.fn.getcwd(),
			editorPid = vim.fn.getpid(),
			replacePending = payload.replacePending == true,
		}
	local bound_ok, bound = pcall(integration.bind_session, binding)
	return bound_ok and bound or false
end

local function prompt_ack(channel, payload)
	local ok, integration = pcall(require, "plugins.ai.pi")
	if ok == false or type(integration.prompt_acknowledge) ~= "function" then
		return false
	end
	local acknowledged, result = pcall(integration.prompt_acknowledge, payload, channel)
	return acknowledged and result == true
end

local handlers = {
	active_context = function(state, _, payload)
		return active_context(state, payload)
	end,
	annotate = function(state, channel, payload)
		return annotate(state, channel, payload)
	end,
	bind_session = function(_, channel, payload)
		return bind_session(channel, payload)
	end,
	clear_highlight = function(state, _, payload)
		return clear_highlight(state, payload)
	end,
	delete_annotations = function(state, _, payload)
		return delete_annotations(state, payload)
	end,
	delete_highlight = function(state, _, payload)
		return delete_highlight(state, payload)
	end,
	diagnostic_summary = function(state, _, payload)
		return diagnostics(state, payload, true)
	end,
	diagnostics = function(state, _, payload)
		return diagnostics(state, payload, false)
	end,
	highlight = function(state, channel, payload)
		return highlight(state, channel, payload)
	end,
	install_notifications = function(state, channel, payload)
		return install_notifications(state, channel, payload)
	end,
	list_buffers = function(_, _, payload)
		return list_buffers(payload)
	end,
	open_file = function(state, _, payload)
		return open_file(state, payload)
	end,
	prompt_ack = function(_, channel, payload)
		return prompt_ack(channel, payload)
	end,
	quickfix = function(_, _, payload)
		return quickfix(payload)
	end,
	read_buffer = function(_, _, payload)
		return read_buffer(payload)
	end,
	remove_notifications = function(state, channel, payload)
		return remove_notifications(state, channel, payload)
	end,
	reveal = function(state, _, payload)
		return reveal(state, payload)
	end,
	visible_windows = function(_, _, payload)
		return visible_windows(payload)
	end,
}

function M.dispatch(request)
	local channel = channel_from_rpc(request)
	if channel == nil or not has_only_keys(request, { channelId = true, operation = true, payload = true }) then
		return invalid_request()
	end
	if type(request.operation) ~= "string" or type(request.payload) ~= "table" then
		return invalid_request()
	end

	local handler = handlers[request.operation]
	if handler == nil then
		return invalid_request()
	end
	local state = channel_state(channel)
	local ok, result = pcall(handler, state, channel, request.payload)
	if ok == false then
		return invalid_request()
	end
	return result
end

return M
