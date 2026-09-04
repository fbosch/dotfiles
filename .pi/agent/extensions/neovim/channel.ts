import { createConnection, type Socket } from "node:net";
import {
  type ActiveContext,
  type BridgeResult,
  type EditorIdentity,
  FOCUS_NOTIFICATION,
  type FocusContext,
  MAX_CONTEXT_BYTES,
  MAX_CONTEXT_LINES,
  noFocusContext,
  noSelection,
  parseActiveContext,
  parseFocusNotification,
  type SelectionSnapshot,
  unavailable,
  worktreesMatch,
} from "./contracts";

const CONNECT_TIMEOUT_MS = 1_000;
const RPC_TIMEOUT_MS = 2_000;

const ACTIVE_CONTEXT_LUA = `
local max_lines, max_bytes = ...
local buffer = vim.api.nvim_get_current_buf()
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
  const originalConsole = {
    assert: console.assert,
    debug: console.debug,
    error: console.error,
    info: console.info,
    log: console.log,
    warn: console.warn,
  };
  try {
    // neovim@5 patches these methods when it lazily creates its default silent logger.
    // Restore them because Pi's stdio is its own RPC/UI channel.
    const { attach } = await import("neovim");
    return attach({ reader: socket, writer: socket });
  } finally {
    Object.assign(console, originalConsole);
  }
}

export class PiNeovimChannel {
  readonly #cwd: string;
  readonly #createConnection: NvimConnectionFactory;
  readonly #socketPath: string | undefined;
  #connectionPromise: Promise<NvimConnection> | undefined;
  #connection: NvimConnection | undefined;
  #editor: EditorIdentity | undefined;
  #focusContext: FocusContext | undefined;
  #unavailableMessage: string | undefined;

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
      return parseActiveContext(
        await withTimeout(
          connection.value.executeLua(ACTIVE_CONTEXT_LUA, [MAX_CONTEXT_LINES, MAX_CONTEXT_BYTES]),
          "Timed out reading context from the bound Neovim instance",
        ),
        this.#cwd,
      );
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
    const selection = context.value.selection;
    return selection === undefined
      ? noSelection()
      : {
          ok: true,
          value: {
            ...selection,
            buffer: context.value.buffer,
            cwd: context.value.cwd,
            pid: context.value.pid,
          },
        };
  }

  async close(): Promise<void> {
    this.#unavailableMessage = "The Neovim channel is closed";
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
    if (this.#unavailableMessage !== undefined) return unavailable(this.#unavailableMessage);
    if (this.#connection !== undefined) return { ok: true, value: this.#connection };
    if (this.#socketPath === undefined || this.#socketPath === "") return unavailable();
    if (this.#connectionPromise === undefined) {
      this.#connectionPromise = this.#connect();
    }
    try {
      return { ok: true, value: await this.#connectionPromise };
    } catch (error) {
      return this.markUnavailable(error instanceof Error ? error.message : String(error));
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
      );
      if (identity.ok === false) throw new Error(identity.error.message);
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

  private markUnavailable(message: string): BridgeResult<never> {
    this.#unavailableMessage = message;
    return unavailable(message);
  }
}

function parseEditorIdentity(value: unknown, expectedCwd: string): BridgeResult<EditorIdentity> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Number.isInteger((value as Record<string, unknown>).pid) === false ||
    Number.isInteger((value as Record<string, unknown>).channelId) === false ||
    typeof (value as Record<string, unknown>).cwd !== "string"
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
  removeNotifications: REMOVE_NOTIFICATIONS_LUA,
} as const;
