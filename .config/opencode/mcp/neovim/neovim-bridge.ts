import { attach, type NeovimClient } from "neovim"
import { hasProperties, isNumber, isRecord, isString } from "./nvim-utils"
import { isDiagnostic, isSourceBuffer } from "./neovim-metadata"

const REQUEST_TIMEOUT_MS = 1000
export const MAX_READ_LINES = 500
export const MAX_READ_BYTES = 32 * 1024
export const MAX_DIAGNOSTIC_SUMMARY_ITEMS = 50
export const DEFAULT_DIAGNOSTIC_SUMMARY_ITEMS = 20
export const MAX_DISCOVERY_BYTES = 32 * 1024
export const MAX_DISCOVERY_ITEMS = 50
export const DEFAULT_DISCOVERY_ITEMS = 20
export const MAX_HIGHLIGHT_LINES = 500
export const DEFAULT_HIGHLIGHT_DURATION_MS = 2000
export const MAX_HIGHLIGHT_DURATION_MS = 30000

const DIAGNOSTICS_LUA = `
local buffer = ...
if buffer == 0 then buffer = vim.api.nvim_get_current_buf() end
if vim.api.nvim_buf_is_valid(buffer) == false or vim.api.nvim_buf_is_loaded(buffer) == false then return { invalid = true } end

local options = vim.bo[buffer]
local diagnostics = vim.tbl_map(function(diagnostic)
  return {
    line = diagnostic.lnum,
    column = diagnostic.col,
    endLine = diagnostic.end_lnum or diagnostic.lnum,
    endColumn = diagnostic.end_col or diagnostic.col,
    severity = diagnostic.severity,
    message = diagnostic.message,
    source = diagnostic.source or "",
  }
end, vim.diagnostic.get(buffer))
return {
  pid = vim.fn.getpid(),
  cwd = vim.fn.getcwd(),
  buffer = {
    number = buffer,
    name = vim.api.nvim_buf_get_name(buffer),
    loaded = true,
    filetype = options.filetype,
    buftype = options.buftype,
    modified = options.modified,
  },
  diagnostics = diagnostics,
}
`

const DIAGNOSTIC_SUMMARY_LUA = `
local buffer, max_items = ...
if buffer == 0 then buffer = vim.api.nvim_get_current_buf() end
if vim.api.nvim_buf_is_valid(buffer) == false or vim.api.nvim_buf_is_loaded(buffer) == false then return { invalid = true } end

local options = vim.bo[buffer]
local diagnostics = vim.diagnostic.get(buffer)
local counts = { error = 0, warning = 0, information = 0, hint = 0, total = #diagnostics }
for _, diagnostic in ipairs(diagnostics) do
  if diagnostic.severity == vim.diagnostic.severity.ERROR then counts.error = counts.error + 1
  elseif diagnostic.severity == vim.diagnostic.severity.WARN then counts.warning = counts.warning + 1
  elseif diagnostic.severity == vim.diagnostic.severity.INFO then counts.information = counts.information + 1
  elseif diagnostic.severity == vim.diagnostic.severity.HINT then counts.hint = counts.hint + 1
  end
end
table.sort(diagnostics, function(left, right)
  if left.severity ~= right.severity then return left.severity < right.severity end
  if left.lnum ~= right.lnum then return left.lnum < right.lnum end
  if left.col ~= right.col then return left.col < right.col end
  if (left.source or "") ~= (right.source or "") then return (left.source or "") < (right.source or "") end
  return left.message < right.message
end)

local items = {}
for index = 1, math.min(max_items, #diagnostics) do
  local diagnostic = diagnostics[index]
  table.insert(items, {
    line = diagnostic.lnum,
    column = diagnostic.col,
    endLine = diagnostic.end_lnum or diagnostic.lnum,
    endColumn = diagnostic.end_col or diagnostic.col,
    severity = diagnostic.severity,
    message = diagnostic.message,
    source = diagnostic.source or "",
  })
end
return {
  pid = vim.fn.getpid(),
  cwd = vim.fn.getcwd(),
  buffer = {
    number = buffer,
    name = vim.api.nvim_buf_get_name(buffer),
    loaded = true,
    filetype = options.filetype,
    buftype = options.buftype,
    modified = options.modified,
  },
  counts = counts,
  diagnostics = items,
}
`

const BUFFER_INVENTORY_LUA = `
local listed = {}
for _, info in ipairs(vim.fn.getbufinfo({ buflisted = 1 })) do
  listed[info.bufnr] = true
end

local buffers = {}
for _, buffer in ipairs(vim.api.nvim_list_bufs()) do
  if listed[buffer] then
    local options = vim.bo[buffer]
    table.insert(buffers, {
      number = buffer,
      name = vim.api.nvim_buf_get_name(buffer),
      loaded = vim.api.nvim_buf_is_loaded(buffer),
      filetype = options.filetype,
      buftype = options.buftype,
      modified = options.modified,
    })
  end
end
return {
  pid = vim.fn.getpid(),
  cwd = vim.fn.getcwd(),
  buffers = buffers,
}
`

const VISIBLE_WINDOWS_LUA = `
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

local windows = {}
for _, window in ipairs(vim.api.nvim_list_wins()) do
  local buffer = vim.api.nvim_win_get_buf(window)
  local options = vim.bo[buffer]
  local viewport = vim.fn.getwininfo(window)[1]
  table.insert(windows, {
    window = window,
    buffer = buffer,
    name = vim.api.nvim_buf_get_name(buffer),
    filetype = options.filetype,
    buftype = options.buftype,
    topline = viewport.topline,
    botline = viewport.botline,
  })
end
return {
  pid = vim.fn.getpid(),
  cwd = vim.fn.getcwd(),
  activeBuffer = buffer_info(vim.api.nvim_get_current_buf()),
  windows = windows,
}
`

const BUFFER_READ_LUA = `
local buffer, requested_start, requested_end, max_lines, max_bytes = ...
if buffer == 0 then buffer = vim.api.nvim_get_current_buf() end
if vim.api.nvim_buf_is_valid(buffer) == false then return { error = "invalidBuffer" } end

local options = vim.bo[buffer]
local metadata = {
  number = buffer,
  name = vim.api.nvim_buf_get_name(buffer),
  loaded = vim.api.nvim_buf_is_loaded(buffer),
  filetype = options.filetype,
  buftype = options.buftype,
  modified = options.modified,
}
if metadata.loaded == false or metadata.name == "" or metadata.buftype ~= "" or metadata.filetype == "opencode" or metadata.filetype == "opencode_terminal" then return { error = "invalidBuffer" } end

local total_lines = vim.api.nvim_buf_line_count(buffer)
local start_line = requested_start == 0 and 1 or requested_start
local end_line = requested_end == 0 and math.min(total_lines, start_line + max_lines - 1) or requested_end
if start_line > total_lines or end_line < start_line or end_line > total_lines then return { error = "invalidRange", totalLines = total_lines } end
if end_line - start_line + 1 > max_lines then return { error = "lineLimit" } end

local lines = vim.api.nvim_buf_get_lines(buffer, start_line - 1, end_line, true)
local bytes = #lines - 1
for _, line in ipairs(lines) do
  bytes = bytes + #line
  if bytes > max_bytes then return { error = "byteLimit" } end
end
return {
  pid = vim.fn.getpid(),
  cwd = vim.fn.getcwd(),
  buffer = metadata,
  startLine = start_line,
  endLine = end_line,
  totalLines = total_lines,
  lines = lines,
}
`

const ACTIVE_CONTEXT_LUA = `
local buffer = vim.api.nvim_get_current_buf()
local options = vim.bo[buffer]
local mode = vim.api.nvim_get_mode().mode
local cursor = vim.api.nvim_win_get_cursor(0)
local selection = vim.NIL
if mode == "v" or mode == "V" or mode == string.char(22) then
  local start = vim.api.nvim_buf_get_mark(buffer, "<")
  local finish = vim.api.nvim_buf_get_mark(buffer, ">")
  selection = {
    mode = mode,
    start = { line = start[1], column = start[2] + 1 },
    ["end"] = { line = finish[1], column = finish[2] + 1 },
  }
end
return {
  pid = vim.fn.getpid(),
  cwd = vim.fn.getcwd(),
  mode = mode,
  activeBuffer = {
    number = buffer,
    name = vim.api.nvim_buf_get_name(buffer),
    loaded = vim.api.nvim_buf_is_loaded(buffer),
    filetype = options.filetype,
    buftype = options.buftype,
    modified = options.modified,
  },
  cursor = { line = cursor[1], column = cursor[2] + 1 },
  selection = selection,
}
`

const FOCUS_CONTEXT_LUA = `
local ok, focus = pcall(vim.api.nvim_get_var, "opencode_last_source_context")
if ok == false or type(focus) ~= "table" or type(focus.buffer) ~= "number" or type(focus.cursor) ~= "table" or type(focus.cursor.line) ~= "number" or type(focus.cursor.column) ~= "number" then return { missing = true } end
if vim.api.nvim_buf_is_valid(focus.buffer) == false then return { stale = true } end

local options = vim.bo[focus.buffer]
return {
  pid = vim.fn.getpid(),
  cwd = vim.fn.getcwd(),
  buffer = {
    number = focus.buffer,
    name = vim.api.nvim_buf_get_name(focus.buffer),
    loaded = vim.api.nvim_buf_is_loaded(focus.buffer),
    filetype = options.filetype,
    buftype = options.buftype,
    modified = options.modified,
  },
  cursor = focus.cursor,
}
`

const SELECTION_LUA = `
local max_lines, max_bytes = ...
local mode = vim.api.nvim_get_mode().mode
if mode ~= "v" and mode ~= "V" and mode ~= string.char(22) then return { error = "missingSelection" } end

local buffer = vim.api.nvim_get_current_buf()
local options = vim.bo[buffer]
local metadata = {
  number = buffer,
  name = vim.api.nvim_buf_get_name(buffer),
  loaded = vim.api.nvim_buf_is_loaded(buffer),
  filetype = options.filetype,
  buftype = options.buftype,
  modified = options.modified,
}
if metadata.loaded == false or metadata.name == "" or metadata.buftype ~= "" or metadata.filetype == "opencode" or metadata.filetype == "opencode_terminal" then return { error = "missingSelection" } end

local anchor = vim.fn.getpos("v")
local cursor = vim.fn.getpos(".")
local lines = vim.fn.getregion(anchor, cursor, { type = mode })
if #lines > max_lines then return { error = "lineLimit" } end

local bytes = #lines - 1
for _, line in ipairs(lines) do
  bytes = bytes + #line
  if bytes > max_bytes then return { error = "byteLimit" } end
end
return {
  pid = vim.fn.getpid(),
  cwd = vim.fn.getcwd(),
  buffer = metadata,
  mode = mode,
  anchor = { line = anchor[2], column = anchor[3] },
  cursor = { line = cursor[2], column = cursor[3] },
  lines = lines,
}
`

const QUICKFIX_LUA = `
local kind, max_items, max_bytes = ...
local list = kind == "location" and vim.fn.getloclist(0, { items = 1, title = 1 }) or vim.fn.getqflist({ items = 1, title = 1 })
local items = {}
for index = 1, math.min(max_items, #list.items) do
  local item = list.items[index]
  local filename = item.filename or ""
  if filename == "" and item.bufnr and item.bufnr > 0 and vim.api.nvim_buf_is_valid(item.bufnr) then filename = vim.api.nvim_buf_get_name(item.bufnr) end
  table.insert(items, {
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
if #vim.json.encode(items) > max_bytes then return { error = "contentLimit" } end
return {
  pid = vim.fn.getpid(),
  cwd = vim.fn.getcwd(),
  kind = kind,
  title = list.title or "",
  total = #list.items,
  items = items,
}
`

const REVEAL_LUA = `
local buffer, line, column, focus, split = ...
if vim.api.nvim_buf_is_valid(buffer) == false or vim.api.nvim_buf_is_loaded(buffer) == false then return { error = "invalidBuffer" } end
local options = vim.bo[buffer]
local metadata = {
  number = buffer,
  name = vim.api.nvim_buf_get_name(buffer),
  loaded = true,
  filetype = options.filetype,
  buftype = options.buftype,
  modified = options.modified,
}
if metadata.name == "" or metadata.buftype ~= "" or metadata.filetype == "opencode" or metadata.filetype == "opencode_terminal" then return { error = "invalidBuffer" } end

local total_lines = vim.api.nvim_buf_line_count(buffer)
if line > total_lines then return { error = "invalidPosition", totalLines = total_lines } end
local text = vim.api.nvim_buf_get_lines(buffer, line - 1, line, true)[1]
if column > #text + 1 then return { error = "invalidColumn", maxColumn = #text + 1 } end

local function is_source_window(window)
  local window_buffer = vim.api.nvim_win_get_buf(window)
  local window_options = vim.bo[window_buffer]
  return vim.api.nvim_buf_is_valid(window_buffer) and vim.api.nvim_buf_is_loaded(window_buffer) and vim.api.nvim_buf_get_name(window_buffer) ~= "" and window_options.buftype == "" and window_options.filetype ~= "opencode" and window_options.filetype ~= "opencode_terminal"
end

local window = nil
for _, candidate in ipairs(vim.api.nvim_list_wins()) do
  if vim.api.nvim_win_get_buf(candidate) == buffer then window = candidate break end
end
if window == nil then
  local ok, recent = pcall(vim.api.nvim_get_var, "opencode_last_source_context")
  if ok and type(recent) == "table" and type(recent.buffer) == "number" then
    for _, candidate in ipairs(vim.api.nvim_list_wins()) do
      if vim.api.nvim_win_get_buf(candidate) == recent.buffer and is_source_window(candidate) then window = candidate break end
    end
  end
end
if window == nil then
  for _, candidate in ipairs(vim.api.nvim_list_wins()) do
    if is_source_window(candidate) then window = candidate break end
  end
end
if window == nil then return { error = "missingSourceWindow" } end

local created = false
if split ~= "none" then
  local direction = split == "horizontal" and "below" or "right"
  window = vim.api.nvim_open_win(buffer, focus, { split = direction, win = window })
  created = true
else
  vim.api.nvim_win_set_buf(window, buffer)
end
vim.api.nvim_win_set_cursor(window, { line, column - 1 })
vim.api.nvim_win_call(window, function() vim.cmd("normal! zz") end)
if focus then vim.api.nvim_set_current_win(window) end
return {
  pid = vim.fn.getpid(),
  cwd = vim.fn.getcwd(),
  buffer = metadata,
  window = window,
  position = { line = line, column = column },
  focused = focus,
  splitCreated = created,
}
`

const HIGHLIGHT_LUA = `
local buffer, path, start_line, start_column, end_line, end_column, duration_ms, reveal, max_lines = ...
if buffer == 0 then
  if type(path) ~= "string" or path == "" or path:sub(1, 1) == "/" then return { error = "invalidPath" } end
  local cwd = vim.fs.normalize(vim.fn.getcwd())
  local filename = vim.fs.normalize(vim.fs.joinpath(cwd, path))
  if filename:sub(1, #cwd + 1) ~= cwd .. "/" or vim.fn.filereadable(filename) == 0 then return { error = "invalidPath" } end
  buffer = vim.fn.bufadd(filename)
  vim.fn.bufload(buffer)
end
if vim.api.nvim_buf_is_valid(buffer) == false or vim.api.nvim_buf_is_loaded(buffer) == false then return { error = "invalidBuffer" } end
local options = vim.bo[buffer]
local metadata = {
  number = buffer,
  name = vim.api.nvim_buf_get_name(buffer),
  loaded = true,
  filetype = options.filetype,
  buftype = options.buftype,
  modified = options.modified,
}
if metadata.name == "" or metadata.buftype ~= "" or metadata.filetype == "opencode" or metadata.filetype == "opencode_terminal" then return { error = "invalidBuffer" } end

local total_lines = vim.api.nvim_buf_line_count(buffer)
if start_line > total_lines then return { error = "invalidRange", totalLines = total_lines } end
if start_column == 0 then start_column = 1 end
if end_line == 0 then end_line = start_line end
if end_column == 0 then
  local end_text = vim.api.nvim_buf_get_lines(buffer, end_line - 1, end_line, true)[1]
  end_column = #end_text + 1
end
if start_line > total_lines or end_line > total_lines or end_line < start_line or (end_line == start_line and end_column < start_column) then return { error = "invalidRange", totalLines = total_lines } end
if end_line - start_line + 1 > max_lines then return { error = "lineLimit" } end
local start_text = vim.api.nvim_buf_get_lines(buffer, start_line - 1, start_line, true)[1]
local end_text = vim.api.nvim_buf_get_lines(buffer, end_line - 1, end_line, true)[1]
if start_column > #start_text + 1 or end_column > #end_text + 1 then return { error = "invalidColumn" } end

local namespace = vim.api.nvim_create_namespace("opencode_mcp_presentation")
local id = vim.api.nvim_buf_set_extmark(buffer, namespace, start_line - 1, start_column - 1, {
  end_row = end_line - 1,
  end_col = end_column - 1,
  hl_group = "Search",
  priority = 200,
})
if duration_ms > 0 then
  vim.defer_fn(function()
    if vim.api.nvim_buf_is_valid(buffer) then vim.api.nvim_buf_del_extmark(buffer, namespace, id) end
  end, duration_ms)
end
local revealed = false
if reveal then
  local window = nil
  for _, candidate in ipairs(vim.api.nvim_list_wins()) do
    if vim.api.nvim_win_get_buf(candidate) == buffer then window = candidate break end
  end
  if window == nil then
    for _, candidate in ipairs(vim.api.nvim_list_wins()) do
      local candidate_buffer = vim.api.nvim_win_get_buf(candidate)
      local candidate_options = vim.bo[candidate_buffer]
      if vim.api.nvim_buf_is_loaded(candidate_buffer) and vim.api.nvim_buf_get_name(candidate_buffer) ~= "" and candidate_options.buftype == "" and candidate_options.filetype ~= "opencode" and candidate_options.filetype ~= "opencode_terminal" then window = candidate break end
    end
  end
  if window ~= nil then
    vim.api.nvim_win_set_buf(window, buffer)
    vim.api.nvim_win_set_cursor(window, { start_line, start_column - 1 })
    vim.api.nvim_win_call(window, function() vim.cmd("normal! zz") end)
    revealed = true
  end
end
return {
  pid = vim.fn.getpid(),
  cwd = vim.fn.getcwd(),
  buffer = metadata,
  highlightId = id,
  start = { line = start_line, column = start_column },
  ["end"] = { line = end_line, column = end_column },
  expiresInMs = duration_ms,
  revealed = revealed,
}
`

const CLEAR_HIGHLIGHT_LUA = `
local buffer, id = ...
if vim.api.nvim_buf_is_valid(buffer) == false then return { error = "invalidBuffer" } end
local namespace = vim.api.nvim_create_namespace("opencode_mcp_presentation")
return { cleared = vim.api.nvim_buf_del_extmark(buffer, namespace, id) }
`

const ANNOTATE_LUA = `
local buffer, line, text, kind, placement, duration_ms, reveal = ...
if vim.api.nvim_buf_is_valid(buffer) == false or vim.api.nvim_buf_is_loaded(buffer) == false then return { error = "invalidBuffer" } end
local options = vim.bo[buffer]
local metadata = { number = buffer, name = vim.api.nvim_buf_get_name(buffer), loaded = true, filetype = options.filetype, buftype = options.buftype, modified = options.modified }
if metadata.name == "" or metadata.buftype ~= "" or metadata.filetype == "opencode" or metadata.filetype == "opencode_terminal" then return { error = "invalidBuffer" } end
local total_lines = vim.api.nvim_buf_line_count(buffer)
if line > total_lines then return { error = "invalidRange", totalLines = total_lines } end
local groups = { note = "Comment", warning = "DiagnosticWarn", error = "DiagnosticError" }
local namespace = vim.api.nvim_create_namespace("opencode_mcp_presentation")
local decoration = { priority = 200 }
if placement == "above" then
  decoration.virt_lines = {{{ "-> " .. text, groups[kind] }}}
  decoration.virt_lines_above = true
elseif placement == "callout" then
  local lines = {}
  local remaining = text
  for index = 1, 3 do
    if remaining == "" then break end
    local part = remaining:sub(1, 72)
    if #remaining > 72 then
      local boundary = part:match("^.*()%s")
      if boundary then part = part:sub(1, boundary - 1) end
    end
    table.insert(lines, {{ index == 1 and "└─ " or "   ", groups[kind] }, { part, groups[kind] }})
    remaining = remaining:sub(#part + 1):gsub("^%s+", "")
  end
  decoration.virt_lines = lines
  decoration.virt_lines_above = false
else
  decoration.virt_text = {{ "  -> " .. text, groups[kind] }}
  decoration.virt_text_pos = "eol"
end
local id = vim.api.nvim_buf_set_extmark(buffer, namespace, line - 1, 0, decoration)
if duration_ms > 0 then vim.defer_fn(function() if vim.api.nvim_buf_is_valid(buffer) then vim.api.nvim_buf_del_extmark(buffer, namespace, id) end end, duration_ms) end
local revealed = false
if reveal then
  local window = nil
  for _, candidate in ipairs(vim.api.nvim_list_wins()) do if vim.api.nvim_win_get_buf(candidate) == buffer then window = candidate break end end
  if window == nil then
    for _, candidate in ipairs(vim.api.nvim_list_wins()) do
      local candidate_buffer = vim.api.nvim_win_get_buf(candidate)
      local candidate_options = vim.bo[candidate_buffer]
      if vim.api.nvim_buf_is_loaded(candidate_buffer) and vim.api.nvim_buf_get_name(candidate_buffer) ~= "" and candidate_options.buftype == "" and candidate_options.filetype ~= "opencode" and candidate_options.filetype ~= "opencode_terminal" then window = candidate break end
    end
  end
  if window ~= nil then vim.api.nvim_win_set_buf(window, buffer); vim.api.nvim_win_set_cursor(window, { line, 0 }); vim.api.nvim_win_call(window, function() vim.cmd("normal! zz") end); revealed = true end
end
return { pid = vim.fn.getpid(), cwd = vim.fn.getcwd(), buffer = metadata, annotationId = id, line = line, text = text, kind = kind, placement = placement, expiresInMs = duration_ms, revealed = revealed }
`

const BUFFER_INFO_GUARDS = { number: isNumber, name: isString, filetype: isString, buftype: isString, loaded: isBoolean, modified: isBoolean }
const VISIBLE_WINDOW_GUARDS = { window: isNumber, buffer: isNumber, name: isString, filetype: isString, buftype: isString, topline: isNumber, botline: isNumber }
const VISIBLE_WINDOWS_SNAPSHOT_GUARDS = { pid: isNumber, cwd: isString, activeBuffer: isBufferInfo, windows: isVisibleWindowList }
const POSITION_GUARDS = { line: isNumber, column: isNumber }
const SELECTION_GUARDS = { mode: isString, start: isPosition, end: isPosition }
const ACTIVE_CONTEXT_SNAPSHOT_GUARDS = { pid: isNumber, cwd: isString, mode: isString, activeBuffer: isBufferInfo, cursor: isPosition, selection: isSelection }
const DIAGNOSTICS_SNAPSHOT_GUARDS = { pid: isNumber, cwd: isString, buffer: isBufferInfo, diagnostics: isDiagnosticList }
const FOCUS_CONTEXT_SNAPSHOT_GUARDS = { pid: isNumber, cwd: isString, buffer: isBufferInfo, cursor: isFocusCursor }
const READ_BUFFER_SNAPSHOT_GUARDS = { pid: isNumber, cwd: isString, buffer: isBufferInfo, startLine: isNumber, endLine: isNumber, totalLines: isNumber, lines: isStringList }
const BUFFER_INVENTORY_SNAPSHOT_GUARDS = { pid: isNumber, cwd: isString, buffers: isBufferInfoList }
const SELECTION_SNAPSHOT_GUARDS = { pid: isNumber, cwd: isString, buffer: isBufferInfo, mode: isString, anchor: isPosition, cursor: isPosition, lines: isStringList }
const DIAGNOSTIC_COUNTS_GUARDS = { error: isNumber, warning: isNumber, information: isNumber, hint: isNumber, total: isNumber }
const DIAGNOSTIC_SUMMARY_SNAPSHOT_GUARDS = { pid: isNumber, cwd: isString, buffer: isBufferInfo, counts: isDiagnosticCounts, diagnostics: isDiagnosticList }
const QUICKFIX_ITEM_GUARDS = { filename: isString, line: isNumber, column: isNumber, endLine: isNumber, endColumn: isNumber, text: isString, type: isString, valid: isBoolean }
const QUICKFIX_SNAPSHOT_GUARDS = { pid: isNumber, cwd: isString, kind: isString, title: isString, total: isNumber, items: isQuickfixItemList }
const REVEAL_SNAPSHOT_GUARDS = { pid: isNumber, cwd: isString, buffer: isBufferInfo, window: isNumber, position: isPosition, focused: isBoolean, splitCreated: isBoolean }
const HIGHLIGHT_SNAPSHOT_GUARDS = { pid: isNumber, cwd: isString, buffer: isBufferInfo, highlightId: isNumber, start: isPosition, end: isPosition, expiresInMs: isNumber, revealed: isBoolean }
const ANNOTATION_SNAPSHOT_GUARDS = { pid: isNumber, cwd: isString, buffer: isBufferInfo, annotationId: isNumber, line: isNumber, text: isString, kind: isString, placement: isString, expiresInMs: isNumber, revealed: isBoolean }

export type BridgeError = {
	code: "NVIM_SOCKET_MISSING" | "NVIM_UNAVAILABLE" | "NVIM_INVALID_RESPONSE" | "NVIM_INVALID_ARGUMENT" | "NVIM_CONTENT_LIMIT"
	message: string
}

export type ActiveContext = {
	instance: { socket: string; pid: number; cwd: string }
	mode: string
	activeBuffer: BufferInfo
	cursor: { line: number; column: number }
	selection: null | { mode: string; start: { line: number; column: number }; end: { line: number; column: number } }
}

export type BridgeFailure = { ok: false; error: BridgeError }
export type BridgeResult = { ok: true; context: ActiveContext } | BridgeFailure
export type VisibleWindow = { window: number; buffer: number; name: string; filetype: string; buftype: string; topline: number; botline: number }
export type VisibleWindows = { instance: ActiveContext["instance"]; activeBuffer: BufferInfo; windows: VisibleWindow[]; sourceWindows: VisibleWindow[] }
export type VisibleWindowsResult = { ok: true; visibleWindows: VisibleWindows } | BridgeFailure
export type BufferInfo = { number: number; name: string; filetype: string; buftype: string; loaded: boolean; modified: boolean }
export type BufferInventory = { instance: ActiveContext["instance"]; buffers: BufferInfo[]; sourceBuffers: BufferInfo[] }
export type BufferInventoryResult = { ok: true; bufferInventory: BufferInventory } | BridgeFailure
export type BufferRead = { instance: ActiveContext["instance"]; buffer: BufferInfo; startLine: number; endLine: number; totalLines: number; lines: string[] }
export type BufferReadResult = { ok: true; bufferRead: BufferRead } | BridgeFailure
export type BufferReadOptions = { buffer?: number; startLine?: number; endLine?: number }
export type Diagnostic = { line: number; column: number; endLine: number; endColumn: number; severity: number; message: string; source: string }
export type DiagnosticsResult = { ok: true; diagnostics: { instance: ActiveContext["instance"]; buffer: BufferInfo; diagnostics: Diagnostic[] } } | BridgeFailure
export type DiagnosticSummaryOptions = { buffer?: number; maxItems: number }
export type DiagnosticSummaryResult = { ok: true; diagnosticSummary: { instance: ActiveContext["instance"]; buffer: BufferInfo; counts: { error: number; warning: number; information: number; hint: number; total: number }; diagnostics: Diagnostic[] } } | BridgeFailure
export type FocusContextResult = { ok: true; focusContext: { instance: ActiveContext["instance"]; buffer: BufferInfo; cursor: { line: number; column: number } } } | BridgeFailure
export type SelectionResult = { ok: true; selection: { instance: ActiveContext["instance"]; buffer: BufferInfo; mode: string; anchor: { line: number; column: number }; cursor: { line: number; column: number }; lines: string[] } } | BridgeFailure
export type QuickfixOptions = { kind: "quickfix" | "location"; maxItems: number }
export type RevealOptions = { buffer: number; line: number; column: number; focus: boolean; split: "none" | "horizontal" | "vertical" }
export type HighlightOptions = { buffer?: number; path?: string; startLine: number; startColumn?: number; endLine?: number; endColumn?: number; durationMs: number; reveal: boolean }
export type ClearHighlightOptions = { buffer: number; highlightId: number }
export type AnnotationOptions = { buffer: number; line: number; text: string; kind: "note" | "warning" | "error"; placement: "above" | "eol" | "callout"; durationMs: number; reveal: boolean }
export type QuickfixResult = { ok: true; quickfix: { instance: ActiveContext["instance"]; kind: "quickfix" | "location"; title: string; total: number; items: QuickfixItem[] } } | BridgeFailure
export type RevealResult = { ok: true; reveal: { instance: ActiveContext["instance"]; buffer: BufferInfo; window: number; position: { line: number; column: number }; focused: boolean; splitCreated: boolean } } | BridgeFailure
export type HighlightResult = { ok: true; highlight: { instance: ActiveContext["instance"]; buffer: BufferInfo; highlightId: number; start: { line: number; column: number }; end: { line: number; column: number }; expiresInMs: number; revealed: boolean } } | BridgeFailure
export type ClearHighlightResult = { ok: true; clearHighlight: { cleared: boolean } } | BridgeFailure
export type AnnotationResult = { ok: true; annotation: { instance: ActiveContext["instance"]; buffer: BufferInfo; annotationId: number; line: number; text: string; kind: "note" | "warning" | "error"; placement: "above" | "eol" | "callout"; expiresInMs: number; revealed: boolean } } | BridgeFailure
export type QuickfixItem = { filename: string; line: number; column: number; endLine: number; endColumn: number; text: string; type: string; valid: boolean }
export type NvimClientFactory = (socket: string) => NeovimClient
export type TimeoutObserver = { created(): void; cleared(): void; fired(): void }
type DiagnosticsSnapshot = { pid: number; cwd: string; buffer: BufferInfo; diagnostics: Diagnostic[] }
type FocusContextSnapshot = { pid: number; cwd: string; buffer: BufferInfo; cursor: { line: number; column: number } }
type ReadBufferSnapshot = { pid: number; cwd: string; buffer: BufferInfo; startLine: number; endLine: number; totalLines: number; lines: string[] }
type BufferInventorySnapshot = { pid: number; cwd: string; buffers: BufferInfo[] }
type SelectionSnapshot = { pid: number; cwd: string; buffer: BufferInfo; mode: string; anchor: { line: number; column: number }; cursor: { line: number; column: number }; lines: string[] }
type DiagnosticCounts = { error: number; warning: number; information: number; hint: number; total: number }
type DiagnosticSummarySnapshot = { pid: number; cwd: string; buffer: BufferInfo; counts: DiagnosticCounts; diagnostics: Diagnostic[] }
type QuickfixSnapshot = { pid: number; cwd: string; kind: "quickfix" | "location"; title: string; total: number; items: QuickfixItem[] }
type RevealSnapshot = { pid: number; cwd: string; buffer: BufferInfo; window: number; position: { line: number; column: number }; focused: boolean; splitCreated: boolean }
type HighlightSnapshot = { pid: number; cwd: string; buffer: BufferInfo; highlightId: number; start: { line: number; column: number }; end: { line: number; column: number }; expiresInMs: number; revealed: boolean }
type AnnotationSnapshot = { pid: number; cwd: string; buffer: BufferInfo; annotationId: number; line: number; text: string; kind: "note" | "warning" | "error"; placement: "above" | "eol" | "callout"; expiresInMs: number; revealed: boolean }

function bridgeError(code: BridgeError["code"], message: string): BridgeFailure {
	return { ok: false, error: { code, message } }
}

function isBoolean(value: unknown): value is boolean {
	return typeof value === "boolean"
}

function withTimeout<T>(request: Promise<T>, observer?: TimeoutObserver): Promise<T> {
	let timer: ReturnType<typeof setTimeout>
	const timeout = new Promise<never>(function(_, reject) {
		observer?.created()
		timer = setTimeout(function() {
			observer?.fired()
			reject(new Error("Neovim RPC request timed out"))
		}, REQUEST_TIMEOUT_MS)
	})
	return Promise.race([request, timeout]).finally(function() {
		clearTimeout(timer)
		observer?.cleared()
	})
}

function isBufferInfo(value: unknown): value is BufferInfo {
	return hasProperties(value, BUFFER_INFO_GUARDS)
}

function isBufferInfoList(value: unknown): value is BufferInfo[] {
	return Array.isArray(value) && value.every(isBufferInfo)
}

function isVisibleWindow(value: unknown): value is VisibleWindow {
	return hasProperties(value, VISIBLE_WINDOW_GUARDS)
}

function isVisibleWindowList(value: unknown): value is VisibleWindow[] {
	return Array.isArray(value) && value.every(isVisibleWindow)
}

function isDiagnosticList(value: unknown): value is Diagnostic[] {
	return Array.isArray(value) && value.every(isDiagnostic)
}

function isDiagnosticCounts(value: unknown): value is DiagnosticCounts {
	return hasProperties(value, DIAGNOSTIC_COUNTS_GUARDS)
}


function isQuickfixItem(value: unknown): value is QuickfixItem {
	return hasProperties(value, QUICKFIX_ITEM_GUARDS)
}

function isQuickfixItemList(value: unknown): value is QuickfixItem[] {
	return Array.isArray(value) && value.every(isQuickfixItem)
}

function isStringList(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(isString)
}

function isVisibleWindowsSnapshot(value: unknown): value is { pid: number; cwd: string; activeBuffer: BufferInfo; windows: VisibleWindow[] } {
	return hasProperties(value, VISIBLE_WINDOWS_SNAPSHOT_GUARDS)
}

function isPosition(value: unknown): value is { line: number; column: number } {
	return hasProperties(value, POSITION_GUARDS)
}

function isSelection(value: unknown): value is ActiveContext["selection"] {
	return value === null || hasProperties(value, SELECTION_GUARDS)
}

function isActiveContextSnapshot(value: unknown): value is Omit<ActiveContext, "instance"> & { pid: number; cwd: string } {
	return hasProperties(value, ACTIVE_CONTEXT_SNAPSHOT_GUARDS)
}

function isDiagnosticsSnapshot(value: unknown): value is DiagnosticsSnapshot {
	return hasProperties(value, DIAGNOSTICS_SNAPSHOT_GUARDS)
}

function invalidDiagnostics(): BridgeFailure {
	return bridgeError("NVIM_INVALID_RESPONSE", "The bound Neovim instance returned invalid diagnostic data")
}

function diagnosticsSnapshotResult(value: unknown): DiagnosticsSnapshot | BridgeFailure {
	if (isRecord(value) && value.invalid === true) return invalidDiagnostics()
	return isDiagnosticsSnapshot(value) ? value : invalidDiagnostics()
}

function isDiagnosticSummarySnapshot(value: unknown): value is DiagnosticSummarySnapshot {
	return hasProperties(value, DIAGNOSTIC_SUMMARY_SNAPSHOT_GUARDS)
}

function diagnosticSummarySnapshotResult(value: unknown): DiagnosticSummarySnapshot | BridgeFailure {
	if (isRecord(value) && value.invalid === true) return invalidDiagnostics()
	return isDiagnosticSummarySnapshot(value) ? value : invalidDiagnostics()
}

function missingFocusContext(): BridgeFailure {
	return bridgeError("NVIM_INVALID_ARGUMENT", "No recent source buffer is available")
}

function staleFocusContext(): BridgeFailure {
	return bridgeError("NVIM_INVALID_ARGUMENT", "The recent source buffer is no longer available")
}

function isFocusContextSnapshot(value: unknown): value is FocusContextSnapshot {
	return hasProperties(value, FOCUS_CONTEXT_SNAPSHOT_GUARDS)
}

function isMissingFocusContext(value: unknown) {
	return isRecord(value) && value.missing === true
}

function isStaleFocusContext(value: unknown) {
	return isRecord(value) && value.stale === true
}

function isUsableFocusContextSnapshot(value: unknown): value is FocusContextSnapshot {
	return isFocusContextSnapshot(value) && isSourceBuffer(value.buffer)
}

function focusContextSnapshotResult(value: unknown): FocusContextSnapshot | BridgeFailure {
	if (isMissingFocusContext(value)) return missingFocusContext()
	if (isStaleFocusContext(value)) return staleFocusContext()
	if (isUsableFocusContextSnapshot(value)) return value
	return staleFocusContext()
}

function invalidBuffer(): BridgeFailure {
	return bridgeError("NVIM_INVALID_ARGUMENT", "Choose a loaded source buffer from nvim_list_buffers or nvim_visible_windows")
}

function invalidReadRange(value: Record<string, unknown>): BridgeFailure {
	if (isNumber(value.totalLines)) return bridgeError("NVIM_INVALID_ARGUMENT", `Choose a line range within 1-${value.totalLines}`)
	throw new Error("Neovim returned invalid read range")
}

const READ_BUFFER_FAILURES: Record<string, (value: Record<string, unknown>) => BridgeFailure> = {
	invalidBuffer,
	invalidRange: invalidReadRange,
	lineLimit: function() { return bridgeError("NVIM_CONTENT_LIMIT", `Read at most ${MAX_READ_LINES} lines; narrow the requested range`) },
	byteLimit: function() { return bridgeError("NVIM_CONTENT_LIMIT", `Read at most ${MAX_READ_BYTES} bytes; narrow the requested range`) },
}

function readBufferFailure(value: unknown): BridgeFailure | undefined {
	if (isRecord(value) === false || isString(value.error) === false) return undefined
	return READ_BUFFER_FAILURES[value.error]?.(value)
}

function isReadBufferSnapshot(value: unknown): value is ReadBufferSnapshot {
	return hasProperties(value, READ_BUFFER_SNAPSHOT_GUARDS)
}

function isBufferInventorySnapshot(value: unknown): value is BufferInventorySnapshot {
	return hasProperties(value, BUFFER_INVENTORY_SNAPSHOT_GUARDS)
}

function readBufferSnapshotResult(value: unknown): ReadBufferSnapshot | BridgeFailure {
	const failure = readBufferFailure(value)
	if (failure) return failure
	if (isReadBufferSnapshot(value)) return value
	throw new Error("Neovim returned invalid buffer content")
}

function missingSelection(): BridgeFailure {
	return bridgeError("NVIM_INVALID_ARGUMENT", "No active source selection is available")
}

const SELECTION_FAILURES: Record<string, (value: Record<string, unknown>) => BridgeFailure> = {
	...READ_BUFFER_FAILURES,
	missingSelection,
}

function selectionSnapshotFailure(value: unknown): BridgeFailure | undefined {
	if (isRecord(value) === false || isString(value.error) === false) return undefined
	return SELECTION_FAILURES[value.error]?.(value)
}

function isSelectionSnapshot(value: unknown): value is SelectionSnapshot {
	return hasProperties(value, SELECTION_SNAPSHOT_GUARDS)
}

function selectionSnapshotResult(value: unknown): SelectionSnapshot | BridgeFailure {
	const failure = selectionSnapshotFailure(value)
	if (failure) return failure
	if (isSelectionSnapshot(value) && isSourceBuffer(value.buffer)) return value
	throw new Error("Neovim returned invalid selection")
}

function discoveryContentLimit(): BridgeFailure {
	return bridgeError("NVIM_CONTENT_LIMIT", `Read at most ${MAX_DISCOVERY_BYTES} bytes of discovery information`)
}

const DISCOVERY_FAILURES: Record<string, (value: Record<string, unknown>) => BridgeFailure> = {
	...READ_BUFFER_FAILURES,
	contentLimit: discoveryContentLimit,
}

function discoveryFailure(value: unknown): BridgeFailure | undefined {
	if (isRecord(value) === false || isString(value.error) === false) return undefined
	return DISCOVERY_FAILURES[value.error]?.(value)
}

function isQuickfixSnapshot(value: unknown): value is QuickfixSnapshot {
	return hasProperties(value, QUICKFIX_SNAPSHOT_GUARDS) && (value.kind === "quickfix" || value.kind === "location")
}

function quickfixSnapshotResult(value: unknown): QuickfixSnapshot | BridgeFailure {
	const failure = discoveryFailure(value)
	if (failure) return failure
	if (isQuickfixSnapshot(value)) return value
	throw new Error("Neovim returned invalid quickfix data")
}

function invalidRevealPosition(value: Record<string, unknown>): BridgeFailure {
	if (isNumber(value.totalLines)) return bridgeError("NVIM_INVALID_ARGUMENT", `Choose a position within 1-${value.totalLines} lines`)
	return bridgeError("NVIM_INVALID_ARGUMENT", "Choose a valid source position")
}

const PRESENTATION_FAILURES: Record<string, (value: Record<string, unknown>) => BridgeFailure> = {
	invalidBuffer,
	invalidPosition: invalidRevealPosition,
	invalidRange: invalidRevealPosition,
	invalidColumn: function() { return bridgeError("NVIM_INVALID_ARGUMENT", "Choose a column within the target line") },
	invalidPath: function() { return bridgeError("NVIM_INVALID_ARGUMENT", "Choose a readable workspace-relative file path") },
	lineLimit: function() { return bridgeError("NVIM_CONTENT_LIMIT", `Highlight at most ${MAX_HIGHLIGHT_LINES} lines`) },
	missingSourceWindow: function() { return bridgeError("NVIM_INVALID_ARGUMENT", "No source window is available for presentation") },
}

function presentationFailure(value: unknown): BridgeFailure | undefined {
	if (isRecord(value) === false || isString(value.error) === false) return undefined
	return PRESENTATION_FAILURES[value.error]?.(value)
}

function isRevealSnapshot(value: unknown): value is RevealSnapshot {
	return hasProperties(value, REVEAL_SNAPSHOT_GUARDS)
}

function revealSnapshotResult(value: unknown): RevealSnapshot | BridgeFailure {
	const failure = presentationFailure(value)
	if (failure) return failure
	if (isRevealSnapshot(value) && isSourceBuffer(value.buffer)) return value
	throw new Error("Neovim returned invalid reveal data")
}

function isHighlightSnapshot(value: unknown): value is HighlightSnapshot {
	return hasProperties(value, HIGHLIGHT_SNAPSHOT_GUARDS)
}

// fallow-ignore-next-line complexity -- validates the fixed annotation enums.
function isAnnotationSnapshot(value: unknown): value is AnnotationSnapshot {
	return hasProperties(value, ANNOTATION_SNAPSHOT_GUARDS) && (value.kind === "note" || value.kind === "warning" || value.kind === "error") && (value.placement === "above" || value.placement === "eol" || value.placement === "callout")
}

function annotationSnapshotResult(value: unknown): AnnotationSnapshot | BridgeFailure {
	const failure = presentationFailure(value)
	if (failure) return failure
	if (isAnnotationSnapshot(value) && isSourceBuffer(value.buffer)) return value
	throw new Error("Neovim returned invalid annotation data")
}

function highlightSnapshotResult(value: unknown): HighlightSnapshot | BridgeFailure {
	const failure = presentationFailure(value)
	if (failure) return failure
	if (isHighlightSnapshot(value) && isSourceBuffer(value.buffer)) return value
	throw new Error("Neovim returned invalid highlight data")
}

function clearHighlightSnapshotResult(value: unknown): { cleared: boolean } | BridgeFailure {
	const failure = presentationFailure(value)
	if (failure) return failure
	if (hasProperties(value, { cleared: isBoolean })) return value
	throw new Error("Neovim returned invalid highlight cleanup data")
}

function isFocusCursor(value: unknown): value is { line: number; column: number } {
	return hasProperties(value, POSITION_GUARDS)
}

export class NvimContextBridge {
	readonly #socket: string | undefined
	readonly #createClient: NvimClientFactory
	readonly #timeoutObserver: TimeoutObserver | undefined
	#client: NeovimClient | undefined
	#unavailable: BridgeError | undefined

	constructor(socket: string | undefined, createClient: NvimClientFactory = function(socket) { return attach({ socket }) }, timeoutObserver?: TimeoutObserver) {
		this.#socket = socket
		this.#createClient = createClient
		this.#timeoutObserver = timeoutObserver
	}

	async context(): Promise<BridgeResult> {
		const client = this.client()
		if ("error" in client) return client
		try {
			const snapshot = await this.activeContextSnapshot(client.nvim)
			const context = { instance: { socket: this.#socket!, pid: snapshot.pid, cwd: snapshot.cwd }, mode: snapshot.mode, activeBuffer: snapshot.activeBuffer, cursor: snapshot.cursor, selection: snapshot.selection }
			return { ok: true, context }
		} catch {
			return this.unavailable()
		}
	}

	async initialize(): Promise<BridgeResult> {
		return this.context()
	}

	async visibleWindows(): Promise<VisibleWindowsResult> {
		const client = this.client()
		if ("error" in client) return client
		try {
			const snapshot = await this.visibleWindowSnapshot(client.nvim)
			return { ok: true, visibleWindows: { instance: { socket: this.#socket!, pid: snapshot.pid, cwd: snapshot.cwd }, activeBuffer: snapshot.activeBuffer, windows: snapshot.windows, sourceWindows: snapshot.windows.filter(isSourceBuffer) } }
		} catch {
			return this.unavailable()
		}
	}

	async bufferInventory(): Promise<BufferInventoryResult> {
		const client = this.client()
		if ("error" in client) return client
		try {
			const snapshot = await this.bufferInventorySnapshot(client.nvim)
			return { ok: true, bufferInventory: { instance: { socket: this.#socket!, pid: snapshot.pid, cwd: snapshot.cwd }, buffers: snapshot.buffers, sourceBuffers: snapshot.buffers.filter(isSourceBuffer) } }
		} catch {
			return this.unavailable()
		}
	}

	async readBuffer(options: BufferReadOptions): Promise<BufferReadResult> {
		const client = this.client()
		if ("error" in client) return client
		try {
			const result = await this.readBufferSnapshot(client.nvim, options)
			if ("error" in result) return result
			return { ok: true, bufferRead: { instance: { socket: this.#socket!, pid: result.pid, cwd: result.cwd }, buffer: result.buffer, startLine: result.startLine, endLine: result.endLine, totalLines: result.totalLines, lines: result.lines } }
		} catch {
			return this.unavailable()
		}
	}

	async diagnostics(bufferNumber?: number): Promise<DiagnosticsResult> {
		const client = this.client()
		if ("error" in client) return client
		try {
			const result = await this.diagnosticsSnapshot(client.nvim, bufferNumber)
			if ("error" in result) return result
			return { ok: true, diagnostics: { instance: { socket: this.#socket!, pid: result.pid, cwd: result.cwd }, buffer: result.buffer, diagnostics: result.diagnostics } }
		} catch {
			return this.unavailable()
		}
	}

	async diagnosticSummary(options: DiagnosticSummaryOptions): Promise<DiagnosticSummaryResult> {
		const client = this.client()
		if ("error" in client) return client
		try {
			const result = await this.diagnosticSummarySnapshot(client.nvim, options)
			if ("error" in result) return result
			return { ok: true, diagnosticSummary: { instance: { socket: this.#socket!, pid: result.pid, cwd: result.cwd }, buffer: result.buffer, counts: result.counts, diagnostics: result.diagnostics } }
		} catch {
			return this.unavailable()
		}
	}

	async focusContext(): Promise<FocusContextResult> {
		const client = this.client()
		if ("error" in client) return client
		try {
			const focus = await this.focusContextSnapshot(client.nvim)
			if ("error" in focus) return focus
			return { ok: true, focusContext: { instance: { socket: this.#socket!, pid: focus.pid, cwd: focus.cwd }, buffer: focus.buffer, cursor: focus.cursor } }
		} catch {
			return this.unavailable()
		}
	}

	async selection(): Promise<SelectionResult> {
		const client = this.client()
		if ("error" in client) return client
		try {
			const result = await this.selectionSnapshot(client.nvim)
			if ("error" in result) return result
			return { ok: true, selection: { instance: { socket: this.#socket!, pid: result.pid, cwd: result.cwd }, buffer: result.buffer, mode: result.mode, anchor: result.anchor, cursor: result.cursor, lines: result.lines } }
		} catch {
			return this.unavailable()
		}
	}

	async quickfix(options: QuickfixOptions): Promise<QuickfixResult> {
		const client = this.client()
		if ("error" in client) return client
		try {
			const result = await this.quickfixSnapshot(client.nvim, options)
			if ("error" in result) return result
			return { ok: true, quickfix: { instance: { socket: this.#socket!, pid: result.pid, cwd: result.cwd }, kind: result.kind, title: result.title, total: result.total, items: result.items } }
		} catch {
			return this.unavailable()
		}
	}

	async reveal(options: RevealOptions): Promise<RevealResult> {
		const client = this.client()
		if ("error" in client) return client
		try {
			const result = await this.revealSnapshot(client.nvim, options)
			if ("error" in result) return result
			return { ok: true, reveal: { instance: { socket: this.#socket!, pid: result.pid, cwd: result.cwd }, buffer: result.buffer, window: result.window, position: result.position, focused: result.focused, splitCreated: result.splitCreated } }
		} catch {
			return this.unavailable()
		}
	}

	async highlight(options: HighlightOptions): Promise<HighlightResult> {
		const client = this.client()
		if ("error" in client) return client
		try {
			const result = await this.highlightSnapshot(client.nvim, options)
			if ("error" in result) return result
			return { ok: true, highlight: { instance: { socket: this.#socket!, pid: result.pid, cwd: result.cwd }, buffer: result.buffer, highlightId: result.highlightId, start: result.start, end: result.end, expiresInMs: result.expiresInMs, revealed: result.revealed } }
		} catch {
			return this.unavailable()
		}
	}

	async clearHighlight(options: ClearHighlightOptions): Promise<ClearHighlightResult> {
		const client = this.client()
		if ("error" in client) return client
		try {
			const result = await this.clearHighlightSnapshot(client.nvim, options)
			if ("error" in result) return result
			return { ok: true, clearHighlight: result }
		} catch {
			return this.unavailable()
		}
	}

	async annotate(options: AnnotationOptions): Promise<AnnotationResult> {
		const client = this.client()
		if ("error" in client) return client
		try {
			const result = await this.annotationSnapshot(client.nvim, options)
			if ("error" in result) return result
			return { ok: true, annotation: { instance: { socket: this.#socket!, pid: result.pid, cwd: result.cwd }, buffer: result.buffer, annotationId: result.annotationId, line: result.line, text: result.text, kind: result.kind, placement: result.placement, expiresInMs: result.expiresInMs, revealed: result.revealed } }
		} catch {
			return this.unavailable()
		}
	}

	async activeContextSnapshot(nvim: NeovimClient): Promise<Omit<ActiveContext, "instance"> & { pid: number; cwd: string }> {
		const snapshot = await withTimeout(nvim.executeLua(ACTIVE_CONTEXT_LUA, []), this.#timeoutObserver)
		if (isActiveContextSnapshot(snapshot) === false) throw new Error("Neovim returned invalid context")
		return snapshot
	}

	async instance(nvim: NeovimClient): Promise<ActiveContext["instance"]> {
		const [pid, cwd] = await withTimeout(Promise.all([nvim.call("getpid"), nvim.call("getcwd")]), this.#timeoutObserver)
		if (isNumber(pid) === false || isString(cwd) === false) throw new Error("Neovim returned invalid instance")
		return { socket: this.#socket!, pid, cwd }
	}

	async bufferInventorySnapshot(nvim: NeovimClient): Promise<BufferInventorySnapshot> {
		const snapshot = await withTimeout(nvim.executeLua(BUFFER_INVENTORY_LUA, []), this.#timeoutObserver)
		if (isBufferInventorySnapshot(snapshot) === false) throw new Error("Neovim returned invalid buffer inventory")
		return snapshot
	}

	async visibleWindowSnapshot(nvim: NeovimClient): Promise<{ pid: number; cwd: string; activeBuffer: BufferInfo; windows: VisibleWindow[] }> {
		const snapshot = await withTimeout(nvim.executeLua(VISIBLE_WINDOWS_LUA, []), this.#timeoutObserver)
		if (isVisibleWindowsSnapshot(snapshot) === false) throw new Error("Neovim returned invalid visible windows")
		return snapshot
	}

	async diagnosticsSnapshot(nvim: NeovimClient, bufferNumber?: number): Promise<DiagnosticsSnapshot | BridgeFailure> {
		const snapshot = await withTimeout(nvim.executeLua(DIAGNOSTICS_LUA, [bufferNumber ?? 0]), this.#timeoutObserver)
		return diagnosticsSnapshotResult(snapshot)
	}

	async diagnosticSummarySnapshot(nvim: NeovimClient, options: DiagnosticSummaryOptions): Promise<DiagnosticSummarySnapshot | BridgeFailure> {
		const snapshot = await withTimeout(nvim.executeLua(DIAGNOSTIC_SUMMARY_LUA, [options.buffer ?? 0, options.maxItems]), this.#timeoutObserver)
		return diagnosticSummarySnapshotResult(snapshot)
	}

	async focusContextSnapshot(nvim: NeovimClient): Promise<FocusContextSnapshot | BridgeFailure> {
		const snapshot = await withTimeout(nvim.executeLua(FOCUS_CONTEXT_LUA, []), this.#timeoutObserver)
		return focusContextSnapshotResult(snapshot)
	}

	async readBufferSnapshot(nvim: NeovimClient, options: BufferReadOptions): Promise<ReadBufferSnapshot | BridgeFailure> {
		const snapshot = await withTimeout(nvim.executeLua(BUFFER_READ_LUA, [options.buffer ?? 0, options.startLine ?? 0, options.endLine ?? 0, MAX_READ_LINES, MAX_READ_BYTES]), this.#timeoutObserver)
		return readBufferSnapshotResult(snapshot)
	}

	async selectionSnapshot(nvim: NeovimClient): Promise<SelectionSnapshot | BridgeFailure> {
		const snapshot = await withTimeout(nvim.executeLua(SELECTION_LUA, [MAX_READ_LINES, MAX_READ_BYTES]), this.#timeoutObserver)
		return selectionSnapshotResult(snapshot)
	}

	async quickfixSnapshot(nvim: NeovimClient, options: QuickfixOptions): Promise<QuickfixSnapshot | BridgeFailure> {
		const snapshot = await withTimeout(nvim.executeLua(QUICKFIX_LUA, [options.kind, options.maxItems, MAX_DISCOVERY_BYTES]), this.#timeoutObserver)
		return quickfixSnapshotResult(snapshot)
	}

	async revealSnapshot(nvim: NeovimClient, options: RevealOptions): Promise<RevealSnapshot | BridgeFailure> {
		const snapshot = await withTimeout(nvim.executeLua(REVEAL_LUA, [options.buffer, options.line, options.column, options.focus, options.split]), this.#timeoutObserver)
		return revealSnapshotResult(snapshot)
	}

	async highlightSnapshot(nvim: NeovimClient, options: HighlightOptions): Promise<HighlightSnapshot | BridgeFailure> {
		const snapshot = await withTimeout(nvim.executeLua(HIGHLIGHT_LUA, highlightSnapshotArguments(options)), this.#timeoutObserver)
		return highlightSnapshotResult(snapshot)
	}

	async clearHighlightSnapshot(nvim: NeovimClient, options: ClearHighlightOptions): Promise<{ cleared: boolean } | BridgeFailure> {
		const snapshot = await withTimeout(nvim.executeLua(CLEAR_HIGHLIGHT_LUA, [options.buffer, options.highlightId]), this.#timeoutObserver)
		return clearHighlightSnapshotResult(snapshot)
	}

	async annotationSnapshot(nvim: NeovimClient, options: AnnotationOptions): Promise<AnnotationSnapshot | BridgeFailure> {
		const snapshot = await withTimeout(nvim.executeLua(ANNOTATE_LUA, [options.buffer, options.line, options.text, options.kind, options.placement, options.durationMs, options.reveal]), this.#timeoutObserver)
		return annotationSnapshotResult(snapshot)
	}

	#clientForSocket(): NeovimClient | BridgeFailure {
		if (typeof this.#socket !== "string" || this.#socket === "") {
			this.#unavailable = { code: "NVIM_SOCKET_MISSING", message: "NVIM_CONTEXT_SOCKET is required; no Neovim instance can be selected" }
			return { ok: false, error: this.#unavailable }
		}
		this.#client ??= this.#createClient(this.#socket)
		return this.#client
	}

	client(): { nvim: NeovimClient } | BridgeFailure {
		if (this.#unavailable) return { ok: false, error: this.#unavailable }
		const client = this.#clientForSocket()
		return "error" in client ? client : { nvim: client }
	}

	unavailable(): BridgeFailure {
		this.#unavailable = { code: "NVIM_UNAVAILABLE", message: "The Neovim instance bound to NVIM_CONTEXT_SOCKET is unavailable" }
		return { ok: false, error: this.#unavailable }
	}
}

function highlightSnapshotArguments(options: HighlightOptions) {
	return [highlightBuffer(options.buffer), highlightPath(options.path), options.startLine, highlightPosition(options.startColumn), highlightPosition(options.endLine), highlightPosition(options.endColumn), options.durationMs, options.reveal, MAX_HIGHLIGHT_LINES]
}

function highlightBuffer(value: number | undefined) {
	return value === undefined ? 0 : value
}

function highlightPath(value: string | undefined) {
	return value === undefined ? "" : value
}

function highlightPosition(value: number | undefined) {
	return value === undefined ? 0 : value
}
