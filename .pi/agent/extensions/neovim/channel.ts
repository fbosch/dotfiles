import { createConnection, type Socket } from "node:net";
import type { Logger } from "neovim/lib/utils/logger";
import {
  type ActiveContext,
  type BridgeResult,
  type BufferInventory,
  type BufferRead,
  type BufferReadOptions,
  type EditorIdentity,
  FOCUS_NOTIFICATION,
  type FocusContext,
  MAX_CONTEXT_BYTES,
  MAX_CONTEXT_LINES,
  MAX_INVENTORY_BYTES,
  MAX_INVENTORY_ITEMS,
  MAX_METADATA_STRING_BYTES,
  type NeovimError,
  noFocusContext,
  noSelection,
  parseActiveContext,
  parseBufferInventory,
  parseBufferRead,
  parseFocusNotification,
  parseVisibleWindows,
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
  installNotifications: INSTALL_NOTIFICATIONS_LUA,
  listBuffers: LIST_BUFFERS_LUA,
  readBuffer: READ_BUFFER_LUA,
  removeNotifications: REMOVE_NOTIFICATIONS_LUA,
  visibleWindows: VISIBLE_WINDOWS_LUA,
} as const;
