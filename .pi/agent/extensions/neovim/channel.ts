import { createConnection, type Socket } from "node:net";
import type { Logger } from "neovim/lib/utils/logger";
import {
  type ActiveContext,
  type BridgeResult,
  type BufferInventory,
  type BufferRead,
  type BufferReadOptions,
  DEFAULT_DIAGNOSTIC_SUMMARY_ITEMS,
  DEFAULT_QUICKFIX_ITEMS,
  type DiagnosticSummary,
  type DiagnosticSummaryOptions,
  type DiagnosticsSnapshot,
  type EditorIdentity,
  FOCUS_NOTIFICATION,
  type FocusContext,
  invalidQuickfixWindow,
  MAX_CONTEXT_BYTES,
  MAX_CONTEXT_LINES,
  MAX_DIAGNOSTIC_BYTES,
  MAX_DIAGNOSTIC_ITEMS,
  MAX_DIAGNOSTIC_SOURCE_ITEMS,
  MAX_INVENTORY_BYTES,
  MAX_INVENTORY_ITEMS,
  MAX_METADATA_STRING_BYTES,
  MAX_QUICKFIX_BYTES,
  MAX_QUICKFIX_ITEMS,
  MAX_QUICKFIX_SOURCE_ITEMS,
  type NeovimError,
  noFocusContext,
  noSelection,
  parseActiveContext,
  parseBufferInventory,
  parseBufferRead,
  parseDiagnosticSummary,
  parseDiagnostics,
  parseFocusNotification,
  parseQuickfix,
  parseVisibleWindows,
  type QuickfixOptions,
  type QuickfixSnapshot,
  quickfixRequestLimit,
  type SelectionSnapshot,
  unavailable,
  type VisibleWindowsSnapshot,
  worktreesMatch,
} from "./contracts";

const CONNECT_TIMEOUT_MS = 1_000;
const RPC_TIMEOUT_MS = 2_000;

class NeovimConnectionError extends Error {
  constructor(readonly bridgeError: NeovimError) {
    super(bridgeError.message);
  }
}

const BIND_SESSION_LUA = `
local session_id = ...
local ok, integration = pcall(require, "utils.pi")
if ok == false or type(integration.bind_session) ~= "function" then return false end
return integration.bind_session(session_id)
`;

const ACTIVE_CONTEXT_LUA = `
local max_lines, max_bytes = ...
local buffer = vim.api.nvim_get_current_buf()
if vim.b[buffer].is_pi_terminal == true then
  local ok, source = pcall(vim.api.nvim_get_var, "pi_launch_source_context")
  if ok and type(source) == "table" then
    -- Neovim can retain a pre-upgrade launcher module while Pi restarts.
    if type(source.mode) ~= "string" then
      local selection = source.selection
      source.mode = type(selection) == "table" and selection.mode or "n"
    end
    return source
  end
  return vim.NIL
end
local options = vim.bo[buffer]
local mode = vim.api.nvim_get_mode().mode
local selection = vim.NIL
if mode == "v" or mode == "V" or mode == string.char(22) then
  local anchor = vim.fn.getpos("v")
  local current = vim.fn.getpos(".")
  local lines = vim.fn.getregion(anchor, current, { type = mode })
  local bytes = math.max(0, #lines - 1)
  for _, line in ipairs(lines) do bytes = bytes + #line end
  if #lines <= max_lines and bytes <= max_bytes then
    selection = {
      mode = mode,
      anchor = { line = anchor[2], column = anchor[3] },
      cursor = { line = current[2], column = current[3] },
      lines = lines,
    }
  else
    selection = { limited = true }
  end
end
local cursor = vim.api.nvim_win_get_cursor(0)
return {
  pid = vim.fn.getpid(),
  cwd = vim.fn.getcwd(),
  mode = mode,
  selection = selection,
  buffer = {
    number = buffer,
    name = vim.api.nvim_buf_get_name(buffer),
    loaded = vim.api.nvim_buf_is_loaded(buffer),
    filetype = options.filetype,
    buftype = options.buftype,
    modified = options.modified,
  },
  cursor = { line = math.max(cursor[1], 1), column = math.max(cursor[2] + 1, 1) },
}
`;

const VISIBLE_WINDOWS_LUA = `
local max_items, max_bytes = ...
local function is_source_buffer(buffer)
  if vim.api.nvim_buf_is_valid(buffer) == false then return false end
  local options = vim.bo[buffer]
  return
    vim.api.nvim_buf_get_name(buffer) ~= ""
    and options.buftype == ""
    and options.modifiable
    and options.filetype ~= "opencode"
    and options.filetype ~= "opencode_terminal"
    and vim.b[buffer].is_pi_terminal ~= true
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

local windows = {}
local bytes = 0
for _, window in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
  local buffer = vim.api.nvim_win_get_buf(window)
  if is_source_buffer(buffer) then
    local viewport = vim.fn.getwininfo(window)[1]
    local info = buffer_info(buffer)
    if #windows >= max_items then return { error = "inventoryLimit" } end
    -- Reserve transport overhead for fixed window and buffer fields.
    bytes = bytes + #info.name + #info.filetype + #info.buftype + 160
    if bytes > max_bytes then return { error = "inventoryLimit" } end
    table.insert(windows, {
      number = window,
      buffer = info,
      topLine = viewport.topline,
      bottomLine = viewport.botline,
    })
  end
end
table.sort(windows, function(left, right) return left.number < right.number end)
return {
  pid = vim.fn.getpid(),
  cwd = vim.fn.getcwd(),
  windows = windows,
}
`;

const LIST_BUFFERS_LUA = `
local max_items, max_bytes = ...
local function is_source_buffer(buffer)
  if vim.api.nvim_buf_is_valid(buffer) == false then return false end
  local options = vim.bo[buffer]
  return
    vim.api.nvim_buf_get_name(buffer) ~= ""
    and options.buftype == ""
    and options.modifiable
    and options.filetype ~= "opencode"
    and options.filetype ~= "opencode_terminal"
    and vim.b[buffer].is_pi_terminal ~= true
end

local buffers = {}
local bytes = 0
for _, buffer in ipairs(vim.api.nvim_list_bufs()) do
  if vim.fn.buflisted(buffer) == 1 and is_source_buffer(buffer) then
    local options = vim.bo[buffer]
    local info = {
      number = buffer,
      name = vim.api.nvim_buf_get_name(buffer),
      loaded = vim.api.nvim_buf_is_loaded(buffer),
      filetype = options.filetype,
      buftype = options.buftype,
      modified = options.modified,
    }
    if #buffers >= max_items then return { error = "inventoryLimit" } end
    -- Reserve transport overhead for fixed buffer fields.
    bytes = bytes + #info.name + #info.filetype + #info.buftype + 128
    if bytes > max_bytes then return { error = "inventoryLimit" } end
    table.insert(buffers, info)
  end
end
table.sort(buffers, function(left, right) return left.number < right.number end)
return {
  pid = vim.fn.getpid(),
  cwd = vim.fn.getcwd(),
  buffers = buffers,
}
`;

const READ_BUFFER_LUA = `
local buffer, requested_start, requested_end, max_lines, max_bytes = ...
if vim.api.nvim_buf_is_valid(buffer) == false then return { error = "invalidBuffer" } end

local options = vim.bo[buffer]
local name = vim.api.nvim_buf_get_name(buffer)
local loaded = vim.api.nvim_buf_is_loaded(buffer)
if
  loaded == false
  or name == ""
  or options.buftype ~= ""
  or options.modifiable == false
  or options.filetype == "opencode"
  or options.filetype == "opencode_terminal"
  or vim.b[buffer].is_pi_terminal == true
then
  return { error = "invalidBuffer" }
end

local total_lines = vim.api.nvim_buf_line_count(buffer)
local start_line = requested_start == 0 and 1 or requested_start
local end_line = requested_end == 0 and math.min(total_lines, start_line + max_lines - 1) or requested_end
if start_line > total_lines or end_line < start_line or end_line > total_lines then
  return { error = "invalidRange", totalLines = total_lines }
end
if end_line - start_line + 1 > max_lines then return { error = "lineLimit" } end

local lines = vim.api.nvim_buf_get_lines(buffer, start_line - 1, end_line, true)
local bytes = math.max(0, #lines - 1)
for _, line in ipairs(lines) do
  bytes = bytes + #line
  if bytes > max_bytes then return { error = "byteLimit" } end
end
return {
  pid = vim.fn.getpid(),
  cwd = vim.fn.getcwd(),
  buffer = {
    number = buffer,
    name = name,
    loaded = loaded,
    filetype = options.filetype,
    buftype = options.buftype,
    modified = options.modified,
  },
  startLine = start_line,
  endLine = end_line,
  totalLines = total_lines,
  lines = lines,
}
`;

const DIAGNOSTICS_LUA = `
local requested_buffer, summary_items, max_items, max_source_items, max_bytes = ...

local function is_integer(value)
  return type(value) == "number" and value >= 0 and value == math.floor(value)
end

local function is_source_buffer(buffer)
  if is_integer(buffer) == false or buffer < 1 then return false end
  if vim.api.nvim_buf_is_valid(buffer) == false or vim.api.nvim_buf_is_loaded(buffer) == false then
    return false
  end
  local options = vim.bo[buffer]
  return
    vim.api.nvim_buf_get_name(buffer) ~= ""
    and options.buftype == ""
    and options.modifiable
    and options.filetype ~= "opencode"
    and options.filetype ~= "opencode_terminal"
    and vim.b[buffer].is_pi_terminal ~= true
end

local function preserved_source_buffer()
  local ok, source = pcall(vim.api.nvim_get_var, "pi_launch_source_context")
  if
    ok == false
    or type(source) ~= "table"
    or type(source.buffer) ~= "table"
    or is_integer(source.buffer.number) == false
    or type(source.buffer.name) ~= "string"
  then
    return nil
  end
  local candidate = source.buffer.number
  if
    is_source_buffer(candidate)
    and vim.api.nvim_buf_get_name(candidate) == source.buffer.name
  then
    return candidate
  end
  return nil
end

local function text_before(left, right)
  local shared_length = math.min(#left, #right)
  for index = 1, shared_length do
    local left_byte = string.byte(left, index)
    local right_byte = string.byte(right, index)
    if left_byte ~= right_byte then return left_byte < right_byte end
  end
  return #left < #right
end

local severity_names = {
  [vim.diagnostic.severity.ERROR] = "error",
  [vim.diagnostic.severity.WARN] = "warning",
  [vim.diagnostic.severity.INFO] = "information",
  [vim.diagnostic.severity.HINT] = "hint",
}
local severity_order = { error = 1, warning = 2, information = 3, hint = 4 }

local function diagnostic_before(left, right)
  if left.severity ~= right.severity then
    return severity_order[left.severity] < severity_order[right.severity]
  end
  if left.start.line ~= right.start.line then return left.start.line < right.start.line end
  if left.start.column ~= right.start.column then return left.start.column < right.start.column end
  if left["end"].line ~= right["end"].line then return left["end"].line < right["end"].line end
  if left["end"].column ~= right["end"].column then
    return left["end"].column < right["end"].column
  end
  if left.source ~= right.source then return text_before(left.source, right.source) end
  return text_before(left.message, right.message)
end

local function retain_diagnostic(diagnostics, diagnostic)
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
    if #diagnostics > summary_items then table.remove(diagnostics) end
  elseif #diagnostics < summary_items then
    table.insert(diagnostics, diagnostic)
  end
end

local buffer = requested_buffer
if buffer == 0 then
  buffer = vim.api.nvim_get_current_buf()
  if is_source_buffer(buffer) == false then buffer = preserved_source_buffer() or -1 end
end
if is_source_buffer(buffer) == false then return { error = "invalidBuffer" } end

local raw_diagnostics = vim.diagnostic.get(buffer)
if #raw_diagnostics > max_source_items then return { error = "diagnosticSourceLimit" } end
if summary_items == 0 and #raw_diagnostics > max_items then
  return { error = "diagnosticLimit" }
end

local diagnostics = {}
local counts = { error = 0, warning = 0, information = 0, hint = 0, total = 0 }
for _, diagnostic in ipairs(raw_diagnostics) do
  local severity = severity_names[diagnostic.severity or vim.diagnostic.severity.ERROR]
  local end_line = diagnostic.end_lnum or diagnostic.lnum
  local end_column = diagnostic.end_col or diagnostic.col
  local source = diagnostic.source or ""
  if
    severity == nil
    or is_integer(diagnostic.lnum) == false
    or is_integer(diagnostic.col) == false
    or is_integer(end_line) == false
    or is_integer(end_column) == false
    or end_line < diagnostic.lnum
    or (end_line == diagnostic.lnum and end_column < diagnostic.col)
    or type(diagnostic.message) ~= "string"
    or type(source) ~= "string"
  then
    return { error = "invalidDiagnostics" }
  end
  counts[severity] = counts[severity] + 1
  retain_diagnostic(diagnostics, {
    start = { line = diagnostic.lnum + 1, column = diagnostic.col + 1 },
    ["end"] = { line = end_line + 1, column = end_column + 1 },
    severity = severity,
    message = diagnostic.message,
    source = source,
  })
end
counts.total = #raw_diagnostics
if summary_items == 0 then table.sort(diagnostics, diagnostic_before) end

local options = vim.bo[buffer]
local name = vim.api.nvim_buf_get_name(buffer)
local bytes = #name + #options.filetype + #options.buftype + 512
for _, diagnostic in ipairs(diagnostics) do
  -- Reserve transport overhead for fixed range and severity fields.
  bytes = bytes + #diagnostic.message + #diagnostic.source + 128
  if bytes > max_bytes then return { error = "diagnosticLimit" } end
end

return {
  pid = vim.fn.getpid(),
  cwd = vim.fn.getcwd(),
  buffer = {
    number = buffer,
    name = name,
    loaded = true,
    filetype = options.filetype,
    buftype = options.buftype,
    modified = options.modified,
  },
  counts = counts,
  diagnostics = diagnostics,
  truncated = #diagnostics < counts.total,
}
`;

const QUICKFIX_LUA = `
local kind, requested_window, max_items, max_source_items, max_bytes = ...

local info
local owner
if kind == "location" then
  if
    type(requested_window) ~= "number"
    or requested_window < 1
    or requested_window ~= math.floor(requested_window)
    or vim.api.nvim_win_is_valid(requested_window) == false
  then
    return { error = "invalidWindow" }
  end
  info = vim.fn.getloclist(requested_window, { id = 0, size = 0, title = 1 })
  owner = { kind = "location", listId = info.id or 0, window = requested_window }
else
  info = vim.fn.getqflist({ id = 0, size = 0, title = 1 })
  owner = { kind = "quickfix", listId = info.id or 0 }
end

local total = info.size or 0
if total > max_source_items then return { error = "sourceLimit" } end
local title = info.title or ""
if #title + 256 > max_bytes then return { error = "contentLimit" } end
-- Neovim exposes no ranged item lookup, so refuse oversized lists before taking its whole snapshot.
local list = kind == "location"
  and vim.fn.getloclist(requested_window, { items = 1 })
  or vim.fn.getqflist({ items = 1 })
local raw_items = list.items or {}
local items = {}
for index = 1, math.min(max_items, total) do
  local item = raw_items[index]
  local buffer = item.bufnr or 0
  local filename = item.filename or ""
  if buffer > 0 and vim.api.nvim_buf_is_valid(buffer) then
    local options = vim.bo[buffer]
    local name = vim.api.nvim_buf_get_name(buffer)
    if
      name == ""
      or options.buftype ~= ""
      or options.filetype == "opencode"
      or options.filetype == "opencode_terminal"
      or vim.b[buffer].is_pi_terminal == true
    then
      return { error = "invalidSource" }
    end
    filename = name
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
if #vim.json.encode(result) > max_bytes then return { error = "contentLimit" } end
return result
`;

const INSTALL_NOTIFICATIONS_LUA = `
local channel, max_lines, max_bytes = ...
local group_name = "PiNeovimBridge" .. channel
local group = vim.api.nvim_create_augroup(group_name, { clear = true })

local function source_snapshot()
  local buffer = vim.api.nvim_get_current_buf()
  local options = vim.bo[buffer]
  local name = vim.api.nvim_buf_get_name(buffer)
  local snapshot
  if
    name ~= ""
    and options.buftype == ""
    and options.filetype ~= "opencode"
    and options.filetype ~= "opencode_terminal"
  then
    local cursor = vim.api.nvim_win_get_cursor(0)
    local mode = vim.api.nvim_get_mode().mode
    local selection = vim.NIL
    if mode == "v" or mode == "V" or mode == string.char(22) then
      local anchor = vim.fn.getpos("v")
      local current = vim.fn.getpos(".")
      local lines = vim.fn.getregion(anchor, current, { type = mode })
      local bytes = math.max(0, #lines - 1)
      for _, line in ipairs(lines) do bytes = bytes + #line end
      if #lines <= max_lines and bytes <= max_bytes then
        selection = {
          mode = mode,
          anchor = { line = anchor[2], column = anchor[3] },
          cursor = { line = current[2], column = current[3] },
          lines = lines,
        }
      else
        selection = { limited = true }
      end
    end

    snapshot = {
      pid = vim.fn.getpid(),
      cwd = vim.fn.getcwd(),
      mode = mode,
      buffer = {
        number = buffer,
        name = name,
        loaded = vim.api.nvim_buf_is_loaded(buffer),
        filetype = options.filetype,
        buftype = options.buftype,
        modified = options.modified,
      },
      cursor = { line = math.max(cursor[1], 1), column = math.max(cursor[2] + 1, 1) },
      selection = selection,
    }
    vim.g.pi_launch_source_context = snapshot
  else
    snapshot = vim.g.pi_launch_source_context
  end
  if type(snapshot) ~= "table" then return end

  vim.rpcnotify(channel, "${FOCUS_NOTIFICATION}", snapshot)
end

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
  callback = source_snapshot,
})
source_snapshot()
return { pid = vim.fn.getpid(), cwd = vim.fn.getcwd(), channelId = channel }
`;

const REMOVE_NOTIFICATIONS_LUA = `
local channel = ...
pcall(vim.api.nvim_del_augroup_by_name, "PiNeovimBridge" .. channel)
vim.g.pi_launch_source_context = nil
return true
`;

export interface NvimConnection {
  readonly channelId: Promise<number>;
  close(): Promise<void>;
  executeLua(code: string, args?: unknown[]): Promise<unknown>;
  off(event: "disconnect" | "notification", listener: (...args: unknown[]) => void): this;
  on(event: "disconnect" | "notification", listener: (...args: unknown[]) => void): this;
  setClientInfo(
    name: string,
    version: object,
    type: string,
    methods: object,
    attributes: object,
  ): void;
}

export type NvimConnectionFactory = (socketPath: string) => Promise<NvimConnection>;

const silentLogger = {
  debug() {},
  error() {},
  info() {},
  level: "error",
  warn() {},
} as unknown as Logger;

function waitForSocket(socket: Socket): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      socket.destroy();
      reject(new Error("Timed out connecting to the inherited Neovim socket"));
    }, CONNECT_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("connect", connected);
      socket.off("error", failed);
    };
    const connected = () => {
      cleanup();
      resolvePromise();
    };
    const failed = (error: Error) => {
      cleanup();
      socket.destroy();
      reject(error);
    };
    socket.once("connect", connected);
    socket.once("error", failed);
  });
}

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), RPC_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolvePromise(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function defaultConnectionFactory(socketPath: string): Promise<NvimConnection> {
  const socket = createConnection(socketPath);
  // Keep connection failures from becoming process-level uncaught errors.
  socket.on("error", () => undefined);
  await waitForSocket(socket);
  const { attach } = await import("neovim");
  // Avoid neovim@5's default Winston logger: Pi's runtime cannot resolve its lazy
  // CJS transport tree reliably, and the logger also monkey-patches global console.
  return attach({ options: { logger: silentLogger }, reader: socket, writer: socket });
}

export class PiNeovimChannel {
  readonly #cwd: string;
  readonly #createConnection: NvimConnectionFactory;
  readonly #socketPath: string | undefined;
  #connectionPromise: Promise<NvimConnection> | undefined;
  #connection: NvimConnection | undefined;
  #editor: EditorIdentity | undefined;
  #focusContext: FocusContext | undefined;
  #unavailableError: NeovimError | undefined;

  constructor(
    socketPath: string | undefined,
    cwd: string,
    createConnection: NvimConnectionFactory = defaultConnectionFactory,
  ) {
    this.#socketPath = socketPath;
    this.#cwd = cwd;
    this.#createConnection = createConnection;
  }

  async status(): Promise<BridgeResult<EditorIdentity>> {
    const connection = await this.connection();
    if (connection.ok === false) return connection;
    if (this.#editor === undefined) return unavailable("Neovim connection identity is unavailable");
    return { ok: true, value: this.#editor };
  }

  async bindSession(sessionId: string): Promise<BridgeResult<EditorIdentity>> {
    if (/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(sessionId) === false) {
      return {
        error: { code: "NVIM_INVALID_RESPONSE", message: "Pi returned an invalid session ID" },
        ok: false,
      };
    }
    const connection = await this.connection();
    if (connection.ok === false) return connection;
    if (this.#editor === undefined) return unavailable("Neovim connection identity is unavailable");
    try {
      const bound = await withTimeout(
        connection.value.executeLua(BIND_SESSION_LUA, [sessionId]),
        "Timed out binding Pi's session identity to Neovim",
      );
      return bound === true
        ? { ok: true, value: this.#editor }
        : {
            error: {
              code: "NVIM_INVALID_RESPONSE",
              message: "Neovim did not accept Pi's session identity",
            },
            ok: false,
          };
    } catch {
      return this.markUnavailable("The bound Neovim instance stopped responding");
    }
  }

  async context(): Promise<BridgeResult<ActiveContext>> {
    const connection = await this.connection();
    if (connection.ok === false) return connection;
    try {
      const snapshot = await withTimeout(
        connection.value.executeLua(ACTIVE_CONTEXT_LUA, [MAX_CONTEXT_LINES, MAX_CONTEXT_BYTES]),
        "Timed out reading context from the bound Neovim instance",
      );
      return snapshot === null || snapshot === undefined
        ? noFocusContext()
        : parseActiveContext(snapshot, this.#cwd);
    } catch {
      return this.markUnavailable("The bound Neovim instance stopped responding");
    }
  }

  async visibleWindows(): Promise<BridgeResult<VisibleWindowsSnapshot>> {
    const connection = await this.connection();
    if (connection.ok === false) return connection;
    if (this.#editor === undefined) return unavailable("Neovim connection identity is unavailable");
    try {
      const snapshot = await withTimeout(
        connection.value.executeLua(VISIBLE_WINDOWS_LUA, [
          MAX_INVENTORY_ITEMS,
          MAX_INVENTORY_BYTES,
        ]),
        "Timed out reading visible windows from the bound Neovim instance",
      );
      return parseVisibleWindows(snapshot, this.#cwd, this.#editor);
    } catch {
      return this.markUnavailable("The bound Neovim instance stopped responding");
    }
  }

  async listBuffers(): Promise<BridgeResult<BufferInventory>> {
    const connection = await this.connection();
    if (connection.ok === false) return connection;
    if (this.#editor === undefined) return unavailable("Neovim connection identity is unavailable");
    try {
      const snapshot = await withTimeout(
        connection.value.executeLua(LIST_BUFFERS_LUA, [MAX_INVENTORY_ITEMS, MAX_INVENTORY_BYTES]),
        "Timed out reading buffers from the bound Neovim instance",
      );
      return parseBufferInventory(snapshot, this.#cwd, this.#editor);
    } catch {
      return this.markUnavailable("The bound Neovim instance stopped responding");
    }
  }

  async readBuffer(options: BufferReadOptions): Promise<BridgeResult<BufferRead>> {
    const connection = await this.connection();
    if (connection.ok === false) return connection;
    if (this.#editor === undefined) return unavailable("Neovim connection identity is unavailable");
    try {
      const snapshot = await withTimeout(
        connection.value.executeLua(READ_BUFFER_LUA, [
          options.buffer,
          options.startLine ?? 0,
          options.endLine ?? 0,
          MAX_CONTEXT_LINES,
          MAX_CONTEXT_BYTES,
        ]),
        "Timed out reading a buffer from the bound Neovim instance",
      );
      return parseBufferRead(snapshot, this.#cwd, this.#editor);
    } catch {
      return this.markUnavailable("The bound Neovim instance stopped responding");
    }
  }

  async diagnosticSummary(
    options: DiagnosticSummaryOptions = {},
  ): Promise<BridgeResult<DiagnosticSummary>> {
    const connection = await this.connection();
    if (connection.ok === false) return connection;
    if (this.#editor === undefined) return unavailable("Neovim connection identity is unavailable");
    const maxItems = options.maxItems ?? DEFAULT_DIAGNOSTIC_SUMMARY_ITEMS;
    try {
      const snapshot = await withTimeout(
        connection.value.executeLua(DIAGNOSTICS_LUA, [
          options.buffer ?? 0,
          maxItems,
          MAX_DIAGNOSTIC_ITEMS,
          MAX_DIAGNOSTIC_SOURCE_ITEMS,
          MAX_DIAGNOSTIC_BYTES,
        ]),
        "Timed out reading diagnostic summary from the bound Neovim instance",
      );
      return parseDiagnosticSummary(snapshot, this.#cwd, this.#editor, maxItems);
    } catch {
      return this.markUnavailable("The bound Neovim instance stopped responding");
    }
  }

  async diagnostics(buffer?: number): Promise<BridgeResult<DiagnosticsSnapshot>> {
    const connection = await this.connection();
    if (connection.ok === false) return connection;
    if (this.#editor === undefined) return unavailable("Neovim connection identity is unavailable");
    try {
      const snapshot = await withTimeout(
        connection.value.executeLua(DIAGNOSTICS_LUA, [
          buffer ?? 0,
          0,
          MAX_DIAGNOSTIC_ITEMS,
          MAX_DIAGNOSTIC_SOURCE_ITEMS,
          MAX_DIAGNOSTIC_BYTES,
        ]),
        "Timed out reading diagnostics from the bound Neovim instance",
      );
      return parseDiagnostics(snapshot, this.#cwd, this.#editor);
    } catch {
      return this.markUnavailable("The bound Neovim instance stopped responding");
    }
  }

  async quickfix(options: QuickfixOptions = {}): Promise<BridgeResult<QuickfixSnapshot>> {
    const maxItems = options.maxItems ?? DEFAULT_QUICKFIX_ITEMS;
    if (Number.isSafeInteger(maxItems) === false || maxItems < 1 || maxItems > MAX_QUICKFIX_ITEMS) {
      return quickfixRequestLimit();
    }
    if (
      options.kind === "location" &&
      (Number.isSafeInteger(options.window) === false || options.window < 1)
    ) {
      return invalidQuickfixWindow();
    }
    const connection = await this.connection();
    if (connection.ok === false) return connection;
    if (this.#editor === undefined) return unavailable("Neovim connection identity is unavailable");
    const kind = options.kind ?? "quickfix";
    const window = options.kind === "location" ? options.window : 0;
    try {
      const snapshot = await withTimeout(
        connection.value.executeLua(QUICKFIX_LUA, [
          kind,
          window,
          maxItems,
          MAX_QUICKFIX_SOURCE_ITEMS,
          MAX_QUICKFIX_BYTES,
        ]),
        "Timed out reading a problem list from the bound Neovim instance",
      );
      return parseQuickfix(snapshot, this.#cwd, this.#editor, options);
    } catch {
      return this.markUnavailable("The bound Neovim instance stopped responding");
    }
  }

  async focusContext(): Promise<BridgeResult<FocusContext>> {
    const connection = await this.connection();
    if (connection.ok === false) return connection;
    return this.#focusContext === undefined
      ? noFocusContext()
      : { ok: true, value: this.#focusContext };
  }

  async selection(): Promise<BridgeResult<SelectionSnapshot>> {
    const context = await this.context();
    if (context.ok === false) return context;
    if (context.value.selection === undefined) return noSelection();
    return {
      ok: true,
      value: {
        ...context.value.selection,
        buffer: context.value.buffer,
        cwd: context.value.cwd,
        pid: context.value.pid,
      },
    };
  }

  async close(): Promise<void> {
    this.#unavailableError = {
      code: "NVIM_UNAVAILABLE",
      message: "The Neovim channel is closed",
    };
    this.#focusContext = undefined;
    this.#editor = undefined;
    await this.#connectionPromise?.catch(() => undefined);
    const connection = this.#connection;
    this.#connection = undefined;
    this.#connectionPromise = undefined;
    this.#focusContext = undefined;
    this.#editor = undefined;
    if (connection === undefined) return;
    connection.off("notification", this.handleNotification);
    connection.off("disconnect", this.handleDisconnect);
    try {
      const channelId = await withTimeout(
        connection.channelId,
        "Timed out closing the bound Neovim instance",
      );
      await withTimeout(
        connection.executeLua(REMOVE_NOTIFICATIONS_LUA, [channelId]),
        "Timed out cleaning up the bound Neovim instance",
      );
    } catch {
      // The editor may already be gone; closing the transport is still required.
    }
    await connection.close().catch(() => undefined);
  }

  private readonly handleNotification = (method: unknown, args: unknown): void => {
    if (typeof method !== "string") return;
    const result = parseFocusNotification(method, args, this.#cwd);
    if (result?.ok === true) this.#focusContext = result.value;
  };

  private readonly handleDisconnect = (): void => {
    this.markUnavailable("The bound Neovim instance disconnected");
  };

  private async connection(): Promise<BridgeResult<NvimConnection>> {
    if (this.#unavailableError !== undefined) {
      return { error: this.#unavailableError, ok: false };
    }
    if (this.#connection !== undefined) return { ok: true, value: this.#connection };
    if (this.#socketPath === undefined || this.#socketPath === "") return unavailable();
    if (this.#connectionPromise === undefined) {
      this.#connectionPromise = this.#connect();
    }
    try {
      const connection = await this.#connectionPromise;
      return this.#unavailableError === undefined
        ? { ok: true, value: connection }
        : { error: this.#unavailableError, ok: false };
    } catch (error) {
      return error instanceof NeovimConnectionError
        ? this.markError(error.bridgeError)
        : this.markUnavailable(error instanceof Error ? error.message : String(error));
    }
  }

  async #connect(): Promise<NvimConnection> {
    const socketPath = this.#socketPath;
    if (socketPath === undefined || socketPath === "") {
      throw new Error("No bound Neovim instance is available");
    }
    const connection = await this.#createConnection(socketPath);
    connection.on("notification", this.handleNotification);
    connection.on("disconnect", this.handleDisconnect);
    try {
      const channelId = await withTimeout(
        connection.channelId,
        "Timed out initializing the bound Neovim instance",
      );
      connection.setClientInfo("pi-neovim", { major: 0, minor: 1 }, "remote", {}, {});
      const identity = parseEditorIdentity(
        await withTimeout(
          connection.executeLua(INSTALL_NOTIFICATIONS_LUA, [
            channelId,
            MAX_CONTEXT_LINES,
            MAX_CONTEXT_BYTES,
          ]),
          "Timed out configuring the bound Neovim instance",
        ),
        this.#cwd,
        channelId,
      );
      if (identity.ok === false) throw new NeovimConnectionError(identity.error);
      this.#connection = connection;
      this.#editor = identity.value;
      return connection;
    } catch (error) {
      connection.off("notification", this.handleNotification);
      connection.off("disconnect", this.handleDisconnect);
      await connection.close().catch(() => undefined);
      throw error;
    }
  }

  private markError(error: NeovimError): BridgeResult<never> {
    this.#unavailableError = error;
    return { error, ok: false };
  }

  private markUnavailable(message: string): BridgeResult<never> {
    return this.markError({ code: "NVIM_UNAVAILABLE", message });
  }
}

function parseEditorIdentity(
  value: unknown,
  expectedCwd: string,
  expectedChannelId: number,
): BridgeResult<EditorIdentity> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Number.isInteger((value as Record<string, unknown>).pid) === false ||
    Number.isInteger((value as Record<string, unknown>).channelId) === false ||
    typeof (value as Record<string, unknown>).cwd !== "string" ||
    Buffer.byteLength((value as Record<string, unknown>).cwd as string, "utf8") >
      MAX_METADATA_STRING_BYTES
  ) {
    return {
      error: {
        code: "NVIM_INVALID_RESPONSE",
        message: "Neovim returned invalid connection identity",
      },
      ok: false,
    };
  }
  const record = value as { channelId: number; cwd: string; pid: number };
  if (record.channelId !== expectedChannelId) {
    return {
      error: {
        code: "NVIM_INVALID_RESPONSE",
        message: "Neovim returned an unexpected channel identity",
      },
      ok: false,
    };
  }
  if (worktreesMatch(record.cwd, expectedCwd) === false) {
    return {
      error: {
        code: "NVIM_WORKTREE_MISMATCH",
        message: "The bound Neovim instance does not match Pi's working directory",
      },
      ok: false,
    };
  }
  return { ok: true, value: record };
}

export const bridgeLua = {
  activeContext: ACTIVE_CONTEXT_LUA,
  bindSession: BIND_SESSION_LUA,
  diagnostics: DIAGNOSTICS_LUA,
  installNotifications: INSTALL_NOTIFICATIONS_LUA,
  listBuffers: LIST_BUFFERS_LUA,
  quickfix: QUICKFIX_LUA,
  readBuffer: READ_BUFFER_LUA,
  removeNotifications: REMOVE_NOTIFICATIONS_LUA,
  visibleWindows: VISIBLE_WINDOWS_LUA,
} as const;
