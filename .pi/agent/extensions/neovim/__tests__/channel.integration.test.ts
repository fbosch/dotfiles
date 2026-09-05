import { expect, test } from "bun:test";
import { access, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { attach } from "neovim";
import { PiNeovimChannel } from "../channel";
import { MAX_ANNOTATION_SEARCH_LINES, MAX_QUICKFIX_SOURCE_ITEMS } from "../contracts";
import {
  createPromptReplayState,
  PROMPT_NOTIFICATION,
  type PromptRequest,
  PromptRequestDispatcher,
} from "../prompt-protocol";

const NVIM_RUNTIME = resolve(import.meta.dir, "../../../../../.config/nvim");

async function waitForSocket(socket: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await access(socket);
      return;
    } catch {
      if (attempt === 99) throw new Error(`Neovim socket did not become available: ${socket}`);
      await Bun.sleep(10);
    }
  }
}

async function withNvim(
  cwd: string,
  setup: string,
  run: (channel: PiNeovimChannel, socket: string) => Promise<void>,
): Promise<void> {
  const socket = `/tmp/pi-neovim-buffer-${process.pid}-${crypto.randomUUID()}.sock`;
  const nvim = Bun.spawn(
    [
      "nvim",
      "-u",
      "NONE",
      "--headless",
      "--cmd",
      "set noswapfile",
      "--cmd",
      `set runtimepath^=${NVIM_RUNTIME}`,
      "--cmd",
      `lua ${setup}`,
      "--listen",
      socket,
    ],
    { cwd, stderr: "ignore", stdout: "ignore" },
  );
  const channel = new PiNeovimChannel(socket, cwd);

  try {
    await waitForSocket(socket);
    await run(channel, socket);
  } finally {
    await channel.close();
    nvim.kill();
    await nvim.exited;
    await rm(socket, { force: true });
  }
}

test("normalizes source context captured by an already-loaded launcher", async () => {
  const cwd = process.cwd();
  const sourceName = join(cwd, "extensions/neovim/channel.ts");
  const socket = `/tmp/pi-neovim-context-${process.pid}-${crypto.randomUUID()}.sock`;
  const setup = [
    "local source = vim.api.nvim_get_current_buf()",
    `vim.api.nvim_buf_set_name(source, ${JSON.stringify(sourceName)})`,
    'vim.bo[source].filetype = "typescript"',
    "require('plugins.ai.pi.bridge').record_source_context({ pid = vim.fn.getpid(), cwd = vim.fn.getcwd(), buffer = { number = source, name = vim.api.nvim_buf_get_name(source), loaded = true, filetype = vim.bo[source].filetype, buftype = vim.bo[source].buftype, modified = vim.bo[source].modified }, cursor = { line = 1, column = 1 } })",
    "local terminal = vim.api.nvim_create_buf(false, true)",
    'vim.api.nvim_buf_set_name(terminal, "pi-terminal-must-not-leak")',
    "vim.b[terminal].is_pi_terminal = true",
    "vim.api.nvim_set_current_buf(terminal)",
  ].join("; ");
  const nvim = Bun.spawn(
    [
      "nvim",
      "-u",
      "NONE",
      "--headless",
      "--cmd",
      "set noswapfile",
      "--cmd",
      `set runtimepath^=${NVIM_RUNTIME}`,
      "--cmd",
      `lua ${setup}`,
      "--listen",
      socket,
    ],
    { cwd, stderr: "ignore", stdout: "ignore" },
  );
  const channel = new PiNeovimChannel(socket, cwd);
  const secondChannel = new PiNeovimChannel(socket, cwd);

  try {
    await waitForSocket(socket);
    expect(await channel.context()).toMatchObject({
      ok: true,
      value: {
        buffer: { name: sourceName },
        cursor: { column: 1, line: 1 },
        mode: "n",
      },
    });
    expect(await secondChannel.context()).toMatchObject({
      ok: true,
      value: { buffer: { name: sourceName } },
    });
    await channel.close();
    expect(await secondChannel.context()).toMatchObject({
      ok: true,
      value: { buffer: { name: sourceName } },
    });
  } finally {
    await Promise.all([channel.close(), secondChannel.close()]);
    nvim.kill();
    await nvim.exited;
    await rm(socket, { force: true });
  }
}, 10_000);

test("round-trips a prompt acknowledgement over the existing channel", async () => {
  const cwd = process.cwd();
  const setup = [
    "vim.g.pi_prompt_ack = vim.NIL",
    "package.loaded['plugins.ai.pi.prompt'] = { acknowledge = function(payload, channel) vim.g.pi_prompt_ack = { payload = payload, channel = channel }; return true end }",
  ].join("; ");

  await withNvim(cwd, setup, async (channel, socket) => {
    const status = await channel.status();
    if (status.ok === false) throw new Error(status.error.message);
    const nvim = attach({ socket });
    const launchId = "0123456789abcdef0123456789abcdef";
    const request: PromptRequest = {
      context: null,
      cwd,
      editorPid: status.value.pid,
      launchId,
      operation: "submit",
      ownerId: "integration",
      requestId: `nvim:${launchId}:1`,
      sequence: 1,
      sessionId: "pi-session-one",
      text: "literal prompt",
      version: 1,
    };
    channel.setPromptRequestHandler((received) => ({
      launchId: received.launchId,
      outcome: "accepted",
      ownerId: received.ownerId,
      requestId: received.requestId,
      sessionId: received.sessionId,
      state: "idle",
      version: 1,
    }));

    await nvim.executeLua(
      "local channel, method, request = ...; vim.rpcnotify(channel, method, request)",
      [status.value.channelId, PROMPT_NOTIFICATION, request],
    );
    let acknowledgement: { channel: number; payload: Record<string, unknown> } | undefined;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const value = await nvim.getVar("pi_prompt_ack");
      if (typeof value === "object" && value !== null && Array.isArray(value) === false) {
        acknowledgement = value as typeof acknowledgement;
        break;
      }
      await Bun.sleep(10);
    }

    expect(acknowledgement).toMatchObject({
      channel: status.value.channelId,
      payload: { outcome: "accepted", requestId: request.requestId },
    });
  });
}, 10_000);

test("delivers captured Ask references and rejects stale guarded reads", async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "pi-ask-context-")));
  const path = join(workspace, "source.lua");
  await Bun.write(path, "disk text\n");
  const setup = [
    `vim.api.nvim_buf_set_name(0, ${JSON.stringify(path)})`,
    'vim.api.nvim_buf_set_lines(0, 0, -1, false, {"æøå", "second", "third"})',
    "vim.g.pi_focus_calls = 0",
  ].join("; ");
  try {
    await withNvim(workspace, setup, async (channel, socket) => {
      const status = await channel.status();
      if (!status.ok) throw new Error(status.error.message);
      const nvim = attach({ socket });
      const binding = {
        channelId: status.value.channelId,
        cwd: workspace,
        editorPid: status.value.pid,
        launchId: "abcdef0123456789abcdef0123456789",
        ownerId: "integration",
        sessionId: "pi-context-session",
        version: 1 as const,
      };
      const sent: string[] = [];
      const pi = {
        sendUserMessage: (text: string, options: { expandPromptTemplates: boolean }) => {
          expect(options.expandPromptTemplates).toBe(false);
          sent.push(text);
        },
      } as unknown as ExtensionAPI;
      const context = {
        cwd: workspace,
        hasUI: true,
        isIdle: () => true,
        mode: "tui",
        sessionManager: { getSessionId: () => binding.sessionId },
      } as unknown as ExtensionContext;
      const dispatcher = new PromptRequestDispatcher(pi, {
        binding: () => binding,
        blockingPromptActive: () => false,
        context: () => context,
        replayState: createPromptReplayState(),
      });
      const received: PromptRequest[] = [];
      channel.setPromptRequestHandler((request) => {
        received.push(request);
        return dispatcher.dispatch(request);
      });
      await nvim.executeLua(
        [
          "local binding = ...",
          "package.loaded['plugins.ai.pi'] = {ensure_started = function() return {} end, prompt_launch = function() return binding end, prompt_identity = function() return binding end, focus_bound = function() vim.g.pi_focus_calls = vim.g.pi_focus_calls + 1; return true end}",
          "vim.ui.input = function(_, confirm) vim.cmd('normal! ' .. string.char(27)); vim.api.nvim_set_current_buf(vim.api.nvim_create_buf(false, true)); confirm('literal question') end",
          "vim.api.nvim_win_set_cursor(0, {1, 0})",
          "vim.cmd('normal! v')",
          "vim.api.nvim_win_set_cursor(0, {3, 1})",
          "assert(require('plugins.ai.pi.prompt').ask(''))",
        ].join("; "),
        [binding],
      );
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if ((await nvim.getVar("pi_focus_calls")) === 1) break;
        await Bun.sleep(10);
      }
      expect(await nvim.getVar("pi_focus_calls")).toBe(1);
      expect(received).toHaveLength(1);
      const reference = received[0]?.context;
      if (reference == null) throw new Error("Ask did not deliver its captured reference");
      expect(reference).toMatchObject({
        path,
        range: {
          anchor: { line: 1, column: 1, offset: 0 },
          cursor: { line: 3, column: 2, offset: 0 },
        },
        selectionMode: "character",
      });
      expect(sent).toEqual(["source.lua:1:1-3:2: literal question"]);
      expect(received[0]?.text).toBe("literal question");
      const read = {
        buffer: reference.buffer,
        expectedPath: reference.path,
        expectedChangedtick: reference.changedtick,
        startLine: 1,
        endLine: 3,
      };
      expect(await channel.readBuffer(read)).toMatchObject({
        ok: true,
        value: { lines: ["æøå", "second", "third"] },
      });
      expect(
        await channel.readBuffer({ ...read, expectedPath: join(workspace, "other.lua") }),
      ).toMatchObject({
        ok: false,
        error: { code: "NVIM_CONTEXT_STALE" },
      });
      await nvim.executeLua(
        "local buffer = ...; vim.api.nvim_buf_set_lines(buffer, 0, 1, false, {'changed'})",
        [reference.buffer],
      );
      expect(await channel.readBuffer(read)).toMatchObject({
        ok: false,
        error: { code: "NVIM_CONTEXT_STALE" },
      });
      expect(await Bun.file(path).text()).toBe("disk text\n");
    });
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
}, 10_000);

test("lists source buffers and reads unsaved text without changing disk", async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "pi-neovim-buffers-")));
  const sourceOne = join(workspace, "one.lua");
  const sourceTwo = join(workspace, "two.lua");
  const unloadedSource = join(workspace, "unloaded.lua");
  const unlistedSource = join(workspace, "unlisted.lua");
  const specialName = join(workspace, "special-buffer");
  const lineLimitSource = join(workspace, "line-limit.lua");
  const byteLimitSource = join(workspace, "byte-limit.lua");
  await Promise.all([
    Bun.write(sourceOne, "local disk = true\nreturn disk\n"),
    Bun.write(sourceTwo, "return 'two'\n"),
    Bun.write(unloadedSource, "return 'unloaded'\n"),
  ]);
  const setup = [
    `local source_one = ${JSON.stringify(sourceOne)}`,
    `local source_two = ${JSON.stringify(sourceTwo)}`,
    `local unloaded_source = ${JSON.stringify(unloadedSource)}`,
    `local unlisted_source = ${JSON.stringify(unlistedSource)}`,
    `local special_name = ${JSON.stringify(specialName)}`,
    `local line_limit_source = ${JSON.stringify(lineLimitSource)}`,
    `local byte_limit_source = ${JSON.stringify(byteLimitSource)}`,
    'vim.cmd("edit " .. vim.fn.fnameescape(source_one))',
    "local modified = vim.api.nvim_get_current_buf()",
    'vim.api.nvim_buf_set_lines(modified, 0, -1, true, { "local unsaved = true", "return unsaved" })',
    'vim.cmd("vsplit")',
    'vim.cmd("edit " .. vim.fn.fnameescape(source_two))',
    "local unlisted = vim.api.nvim_create_buf(false, false)",
    "vim.api.nvim_buf_set_name(unlisted, unlisted_source)",
    "local unnamed = vim.api.nvim_create_buf(true, false)",
    "local special = vim.api.nvim_create_buf(true, true)",
    "vim.api.nvim_buf_set_name(special, special_name)",
    "local unloaded = vim.fn.bufadd(unloaded_source)",
    "vim.bo[unloaded].buflisted = true",
    "local line_limit = vim.api.nvim_create_buf(true, false)",
    "vim.api.nvim_buf_set_name(line_limit, line_limit_source)",
    "local many_lines = {}",
    'for index = 1, 501 do many_lines[index] = "line" end',
    "vim.api.nvim_buf_set_lines(line_limit, 0, -1, true, many_lines)",
    "local byte_limit = vim.api.nvim_create_buf(true, false)",
    "vim.api.nvim_buf_set_name(byte_limit, byte_limit_source)",
    'vim.api.nvim_buf_set_lines(byte_limit, 0, -1, true, { string.rep("x", 32769) })',
  ].join("; ");

  try {
    await withNvim(workspace, setup, async (channel) => {
      const inventory = await channel.listBuffers();
      expect(inventory.ok).toBe(true);
      if (inventory.ok === false) return;

      const names = inventory.value.buffers.map((buffer) => buffer.name);
      expect(names).toEqual(
        expect.arrayContaining([
          sourceOne,
          sourceTwo,
          unloadedSource,
          lineLimitSource,
          byteLimitSource,
        ]),
      );
      expect(names).not.toContain(unlistedSource);
      expect(names).not.toContain(specialName);
      expect(inventory.value.buffers.some((buffer) => buffer.name === "")).toBe(false);
      expect(inventory.value.buffers.find((buffer) => buffer.name === sourceOne)).toMatchObject({
        loaded: true,
        modified: true,
      });
      expect(
        inventory.value.buffers.find((buffer) => buffer.name === unloadedSource),
      ).toMatchObject({ loaded: false, modified: false });

      const visible = await channel.visibleWindows();
      expect(visible.ok).toBe(true);
      if (visible.ok === false) return;
      expect(visible.value.windows).toHaveLength(2);
      expect(visible.value.windows.map((window) => window.buffer.name)).toEqual(
        expect.arrayContaining([sourceOne, sourceTwo]),
      );

      const modified = inventory.value.buffers.find((buffer) => buffer.name === sourceOne);
      if (modified === undefined) throw new Error("modified source buffer was not listed");
      expect(await channel.readBuffer({ buffer: modified.number })).toMatchObject({
        ok: true,
        value: {
          buffer: { modified: true, name: sourceOne },
          endLine: 2,
          lines: ["local unsaved = true", "return unsaved"],
          startLine: 1,
          totalLines: 2,
        },
      });
      expect(await Bun.file(sourceOne).text()).toBe("local disk = true\nreturn disk\n");

      const lineLimit = inventory.value.buffers.find((buffer) => buffer.name === lineLimitSource);
      const byteLimit = inventory.value.buffers.find((buffer) => buffer.name === byteLimitSource);
      if (lineLimit === undefined || byteLimit === undefined) {
        throw new Error("bounded-read fixture buffers were not listed");
      }
      expect(
        await channel.readBuffer({ buffer: lineLimit.number, endLine: 501, startLine: 1 }),
      ).toMatchObject({ error: { code: "NVIM_LIMIT_EXCEEDED" }, ok: false });
      expect(await channel.readBuffer({ buffer: byteLimit.number })).toMatchObject({
        error: { code: "NVIM_LIMIT_EXCEEDED" },
        ok: false,
      });
      expect(await channel.readBuffer({ buffer: 999 })).toMatchObject({
        error: { code: "NVIM_INVALID_BUFFER" },
        ok: false,
      });
      expect(await channel.readBuffer({ buffer: modified.number, startLine: 3 })).toMatchObject({
        error: { code: "NVIM_INVALID_RANGE" },
        ok: false,
      });
    });
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
}, 10_000);

test("reads ordered diagnostics for unsaved source through preserved Pi context", async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "pi-neovim-diagnostics-")));
  const source = join(workspace, "diagnostics.lua");
  await Bun.write(source, "local disk = true\nreturn disk\n");
  const setup = [
    `local source_name = ${JSON.stringify(source)}`,
    'vim.cmd("edit " .. vim.fn.fnameescape(source_name))',
    "local source = vim.api.nvim_get_current_buf()",
    'vim.api.nvim_buf_set_lines(source, 0, -1, true, { "local unsaved = unknown", "return unsaved", "-- hint" })',
    "require('plugins.ai.pi.bridge').record_source_context({ pid = vim.fn.getpid(), cwd = vim.fn.getcwd(), mode = 'n', buffer = { number = source, name = vim.api.nvim_buf_get_name(source), loaded = true, filetype = vim.bo[source].filetype, buftype = vim.bo[source].buftype, modified = vim.bo[source].modified }, cursor = { line = 1, column = 1 } })",
    "local namespace = vim.api.nvim_create_namespace('pi-diagnostic-test')",
    "vim.diagnostic.set(namespace, source, { { lnum = 2, col = 0, end_lnum = 2, end_col = 4, severity = vim.diagnostic.severity.HINT, message = 'hint', source = 'editor-lint' }, { lnum = 0, col = 16, end_lnum = 0, end_col = 23, severity = vim.diagnostic.severity.WARN, message = 'warning', source = 'editor-lint' }, { lnum = 1, col = 0, end_lnum = 1, end_col = 6, severity = vim.diagnostic.severity.INFO, message = 'information', source = 'neovim-plugin' }, { lnum = 0, col = 6, end_lnum = 0, end_col = 13, severity = vim.diagnostic.severity.ERROR, message = 'unknown variable', source = 'neovim-lsp' } })",
    "local readonly = vim.api.nvim_create_buf(true, false)",
    `vim.api.nvim_buf_set_name(readonly, ${JSON.stringify(join(workspace, "readonly.lua"))})`,
    "vim.bo[readonly].modifiable = false",
    "local special = vim.api.nvim_create_buf(true, true)",
    `vim.api.nvim_buf_set_name(special, ${JSON.stringify(join(workspace, "special"))})`,
    "local excluded = vim.api.nvim_create_buf(true, false)",
    `vim.api.nvim_buf_set_name(excluded, ${JSON.stringify(join(workspace, "excluded.lua"))})`,
    'vim.bo[excluded].filetype = "opencode"',
    "local terminal = vim.api.nvim_create_buf(false, true)",
    'vim.api.nvim_buf_set_name(terminal, "pi-terminal-must-not-leak")',
    "vim.b[terminal].is_pi_terminal = true",
    "vim.api.nvim_set_current_buf(terminal)",
  ].join("; ");

  try {
    await withNvim(workspace, setup, async (channel) => {
      expect(await channel.diagnosticSummary({ maxItems: 2 })).toMatchObject({
        ok: true,
        value: {
          buffer: { modified: true, name: source },
          counts: { error: 1, hint: 1, information: 1, total: 4, warning: 1 },
          diagnostics: [
            {
              end: { column: 14, line: 1 },
              message: "unknown variable",
              severity: "error",
              source: "neovim-lsp",
              start: { column: 7, line: 1 },
            },
            { message: "warning", severity: "warning" },
          ],
          truncated: true,
        },
      });

      const diagnostics = await channel.diagnostics();
      expect(diagnostics).toMatchObject({
        ok: true,
        value: {
          buffer: { modified: true, name: source },
          diagnostics: [
            { message: "unknown variable", severity: "error" },
            { message: "warning", severity: "warning" },
            { message: "information", severity: "information" },
            { message: "hint", severity: "hint" },
          ],
          total: 4,
        },
      });
      expect(JSON.stringify(diagnostics)).not.toContain("pi-terminal-must-not-leak");
      for (const invalidBuffer of [2, 3, 4, 999]) {
        expect(await channel.diagnostics(invalidBuffer)).toMatchObject({
          error: { code: "NVIM_INVALID_BUFFER" },
          ok: false,
        });
      }
      expect(await Bun.file(source).text()).toBe("local disk = true\nreturn disk\n");
    });
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
}, 10_000);

test("reads bounded quickfix and explicitly owned location lists", async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "pi-neovim-quickfix-")));
  const source = join(workspace, "problem-list.lua");
  const emptySource = join(workspace, "empty-location.lua");
  await Promise.all([
    Bun.write(
      source,
      `${Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join("\n")}\n`,
    ),
    Bun.write(emptySource, "return true\n"),
  ]);
  const setup = [
    `local source_name = ${JSON.stringify(source)}`,
    `local empty_source = ${JSON.stringify(emptySource)}`,
    'vim.cmd("edit " .. vim.fn.fnameescape(source_name))',
    "local source_buffer = vim.api.nvim_get_current_buf()",
    "local source_window = vim.api.nvim_get_current_win()",
    "local quickfix_items = {}",
    "for index = 1, 60 do quickfix_items[index] = { bufnr = source_buffer, lnum = index, col = 2, end_lnum = index, end_col = 4, text = 'problem ' .. index, type = 'E' } end",
    "vim.fn.setqflist({}, 'r', { title = 'quickfix fixture', items = quickfix_items })",
    "local location_items = {}",
    "for index = 1, 60 do location_items[index] = { bufnr = source_buffer, lnum = index, col = 3, end_lnum = index, end_col = 7, text = 'location problem ' .. index, type = 'W' } end",
    "vim.fn.setloclist(source_window, {}, 'r', { title = 'location fixture', items = location_items })",
    'vim.cmd("vsplit")',
    'vim.cmd("edit " .. vim.fn.fnameescape(empty_source))',
    "vim.fn.setloclist(0, {}, 'r', { title = 'empty location', items = {} })",
  ].join("; ");

  try {
    await withNvim(workspace, setup, async (channel) => {
      const visible = await channel.visibleWindows();
      if (visible.ok === false) throw new Error(visible.error.message);
      const sourceWindow = visible.value.windows.find((window) => window.buffer.name === source);
      const emptyWindow = visible.value.windows.find(
        (window) => window.buffer.name === emptySource,
      );
      if (sourceWindow === undefined || emptyWindow === undefined) {
        throw new Error("problem-list owner windows were not visible");
      }

      const defaults = await channel.quickfix();
      expect(defaults).toMatchObject({
        ok: true,
        value: {
          owner: { kind: "quickfix", listId: expect.any(Number) },
          title: "quickfix fixture",
          total: 60,
          truncated: true,
        },
      });
      if (defaults.ok === false) return;
      expect(defaults.value.items).toHaveLength(20);
      expect(defaults.value.items[0]).toMatchObject({
        column: 2,
        endColumn: 4,
        endLine: 1,
        filename: source,
        line: 1,
        text: "problem 1",
        type: "E",
        valid: true,
      });
      expect(defaults.value.items.at(-1)?.text).toBe("problem 20");

      const maximum = await channel.quickfix({ maxItems: 50 });
      expect(maximum).toMatchObject({ ok: true, value: { total: 60, truncated: true } });
      if (maximum.ok === false) return;
      expect(maximum.value.items).toHaveLength(50);
      expect(maximum.value.items.at(-1)?.text).toBe("problem 50");

      const locationDefaults = await channel.quickfix({
        kind: "location",
        window: sourceWindow.number,
      });
      expect(locationDefaults).toMatchObject({
        ok: true,
        value: {
          owner: {
            kind: "location",
            listId: expect.any(Number),
            window: sourceWindow.number,
          },
          title: "location fixture",
          total: 60,
          truncated: true,
        },
      });
      if (locationDefaults.ok === false) return;
      expect(locationDefaults.value.items).toHaveLength(20);
      expect(locationDefaults.value.items[0]).toMatchObject({
        column: 3,
        endColumn: 7,
        endLine: 1,
        filename: source,
        line: 1,
        text: "location problem 1",
      });
      expect(locationDefaults.value.items.at(-1)?.text).toBe("location problem 20");

      const locationMaximum = await channel.quickfix({
        kind: "location",
        maxItems: 50,
        window: sourceWindow.number,
      });
      expect(locationMaximum).toMatchObject({
        ok: true,
        value: { total: 60, truncated: true },
      });
      if (locationMaximum.ok === false) return;
      expect(locationMaximum.value.items).toHaveLength(50);
      expect(locationMaximum.value.items.at(-1)?.text).toBe("location problem 50");
      expect(
        await channel.quickfix({ kind: "location", window: emptyWindow.number }),
      ).toMatchObject({
        ok: true,
        value: {
          items: [],
          owner: { kind: "location", window: emptyWindow.number },
          title: "empty location",
          total: 0,
          truncated: false,
        },
      });
      expect(await channel.quickfix({ kind: "location", window: 999_999 })).toMatchObject({
        error: { code: "NVIM_INVALID_WINDOW" },
        ok: false,
      });
    });
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
}, 10_000);

test("reveals exact source positions while preserving focus unless explicitly requested", async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "pi-neovim-reveal-")));
  const outsideWorkspace = await realpath(
    await mkdtemp(join(tmpdir(), "pi-neovim-reveal-outside-")),
  );
  const target = join(workspace, "target.lua");
  const anchor = join(workspace, "anchor.lua");
  const outside = join(outsideWorkspace, "outside.lua");
  const linkedOutside = join(workspace, "linked", "outside.lua");
  const linkedMissing = join(workspace, "linked", "missing.lua");
  const targetText = "first line\nsecond æ line\nthird line\n";
  await Promise.all([
    Bun.write(target, targetText),
    Bun.write(anchor, "return 'anchor'\n"),
    Bun.write(outside, "return 'outside'\n"),
  ]);
  await symlink(outsideWorkspace, join(workspace, "linked"));
  const setup = [
    `local target_name = ${JSON.stringify(target)}`,
    `local anchor_name = ${JSON.stringify(anchor)}`,
    `local outside_name = ${JSON.stringify(outside)}`,
    `local linked_outside_name = ${JSON.stringify(linkedOutside)}`,
    `local linked_missing_name = ${JSON.stringify(linkedMissing)}`,
    'vim.cmd("edit " .. vim.fn.fnameescape(target_name))',
    "local target_buffer = vim.api.nvim_get_current_buf()",
    'vim.cmd("edit " .. vim.fn.fnameescape(anchor_name))',
    "local anchor_buffer = vim.api.nvim_get_current_buf()",
    "local anchor_window = vim.api.nvim_get_current_win()",
    "local outside_buffer = vim.fn.bufadd(outside_name)",
    "vim.fn.bufload(outside_buffer)",
    "local linked_outside_buffer = vim.fn.bufadd(linked_outside_name)",
    "vim.fn.bufload(linked_outside_buffer)",
    "local linked_missing_buffer = vim.api.nvim_create_buf(false, false)",
    "vim.api.nvim_buf_set_name(linked_missing_buffer, linked_missing_name)",
    'vim.cmd("vsplit")',
    "local terminal = vim.api.nvim_create_buf(false, true)",
    'vim.api.nvim_buf_set_name(terminal, "pi-reveal-terminal")',
    "vim.b[terminal].is_pi_terminal = true",
    "vim.api.nvim_set_current_buf(terminal)",
    "vim.g.pi_reveal_unrequested_events = 0",
    "vim.api.nvim_create_autocmd({ 'BufEnter', 'BufLeave', 'WinEnter', 'WinLeave' }, { callback = function() vim.g.pi_reveal_unrequested_events = vim.g.pi_reveal_unrequested_events + 1 end })",
    "require('plugins.ai.pi.bridge').record_source_context({ buffer = { number = anchor_buffer } })",
    "vim.g.pi_reveal_test = { target = target_buffer, outside = outside_buffer, linkedOutside = linked_outside_buffer, linkedMissing = linked_missing_buffer, anchorWindow = anchor_window, terminal = terminal }",
  ].join("; ");

  try {
    await withNvim(workspace, setup, async (channel, socket) => {
      const nvim = attach({ socket });
      const inventory = await channel.listBuffers();
      if (inventory.ok === false) throw new Error(inventory.error.message);
      const targetBuffer = inventory.value.buffers.find((buffer) => buffer.name === target);
      if (targetBuffer === undefined) throw new Error("hidden reveal target was not listed");
      const initial = (await nvim.executeLua(
        "return { currentWindow = vim.api.nvim_get_current_win(), currentBuffer = vim.api.nvim_get_current_buf(), unrequestedEvents = vim.g.pi_reveal_unrequested_events, windows = #vim.api.nvim_tabpage_list_wins(0), outside = vim.g.pi_reveal_test.outside, linkedOutside = vim.g.pi_reveal_test.linkedOutside, linkedMissing = vim.g.pi_reveal_test.linkedMissing }",
        [],
      )) as {
        currentBuffer: number;
        currentWindow: number;
        linkedMissing: number;
        linkedOutside: number;
        outside: number;
        unrequestedEvents: number;
        windows: number;
      };

      const defaultReveal = await channel.reveal({
        buffer: targetBuffer.number,
        column: 10,
        line: 2,
      });
      expect(defaultReveal).toMatchObject({
        ok: true,
        value: {
          buffer: { name: target, number: targetBuffer.number },
          focused: false,
          focusPreserved: true,
          position: { column: 10, line: 2 },
          split: "none",
          splitCreated: false,
        },
      });
      if (defaultReveal.ok === false) return;
      expect(
        await nvim.executeLua(
          "local window = ...; return { currentWindow = vim.api.nvim_get_current_win(), currentBuffer = vim.api.nvim_get_current_buf(), revealedBuffer = vim.api.nvim_win_get_buf(window), cursor = vim.api.nvim_win_get_cursor(window), unrequestedEvents = vim.g.pi_reveal_unrequested_events, windows = #vim.api.nvim_tabpage_list_wins(0) }",
          [defaultReveal.value.window],
        ),
      ).toEqual({
        currentBuffer: initial.currentBuffer,
        currentWindow: initial.currentWindow,
        cursor: [2, 9],
        revealedBuffer: targetBuffer.number,
        unrequestedEvents: initial.unrequestedEvents,
        windows: initial.windows,
      });

      const horizontal = await channel.reveal({
        buffer: targetBuffer.number,
        column: 10,
        line: 1,
        split: "horizontal",
      });
      expect(horizontal).toMatchObject({
        ok: true,
        value: {
          focused: false,
          focusPreserved: true,
          split: "horizontal",
          splitCreated: true,
        },
      });
      if (horizontal.ok === false) return;
      expect(
        await nvim.executeLua(
          "local window = ...; return { currentWindow = vim.api.nvim_get_current_win(), cursor = vim.api.nvim_win_get_cursor(window), split = vim.api.nvim_win_get_config(window).split, unrequestedEvents = vim.g.pi_reveal_unrequested_events, windows = #vim.api.nvim_tabpage_list_wins(0) }",
          [horizontal.value.window],
        ),
      ).toEqual({
        currentWindow: initial.currentWindow,
        cursor: [1, 9],
        split: "below",
        unrequestedEvents: initial.unrequestedEvents,
        windows: initial.windows + 1,
      });

      const vertical = await channel.reveal({
        buffer: targetBuffer.number,
        column: 3,
        focus: true,
        line: 3,
        split: "vertical",
      });
      expect(vertical).toMatchObject({
        ok: true,
        value: { focused: true, split: "vertical", splitCreated: true },
      });
      if (vertical.ok === false) return;
      expect(
        await nvim.executeLua(
          "local window = ...; return { currentWindow = vim.api.nvim_get_current_win(), cursor = vim.api.nvim_win_get_cursor(window), split = vim.api.nvim_win_get_config(window).split, windows = #vim.api.nvim_tabpage_list_wins(0) }",
          [vertical.value.window],
        ),
      ).toEqual({
        currentWindow: vertical.value.window,
        cursor: [3, 2],
        split: "right",
        windows: initial.windows + 2,
      });

      const beforeFailedSplit = await nvim.executeLua(
        "return { currentWindow = vim.api.nvim_get_current_win(), currentBuffer = vim.api.nvim_get_current_buf(), cursor = vim.api.nvim_win_get_cursor(0), windows = #vim.api.nvim_tabpage_list_wins(0) }",
        [],
      );
      await nvim.executeLua(
        "vim.g.pi_original_win_set_cursor = vim.api.nvim_win_set_cursor; vim.api.nvim_win_set_cursor = function() error('forced split failure') end",
        [],
      );
      expect(
        await channel.reveal({
          buffer: targetBuffer.number,
          column: 1,
          line: 1,
          split: "horizontal",
        }),
      ).toMatchObject({ error: { code: "NVIM_INVALID_WINDOW" }, ok: false });
      await nvim.executeLua(
        "vim.api.nvim_win_set_cursor = vim.g.pi_original_win_set_cursor; vim.g.pi_original_win_set_cursor = nil",
        [],
      );
      expect(
        await nvim.executeLua(
          "return { currentWindow = vim.api.nvim_get_current_win(), currentBuffer = vim.api.nvim_get_current_buf(), cursor = vim.api.nvim_win_get_cursor(0), windows = #vim.api.nvim_tabpage_list_wins(0) }",
          [],
        ),
      ).toEqual(beforeFailedSplit);

      const beforeRejected = await nvim.executeLua(
        "return { currentWindow = vim.api.nvim_get_current_win(), currentBuffer = vim.api.nvim_get_current_buf(), windows = #vim.api.nvim_tabpage_list_wins(0) }",
        [],
      );
      for (const outsideBuffer of [initial.outside, initial.linkedOutside, initial.linkedMissing]) {
        expect(await channel.reveal({ buffer: outsideBuffer, column: 1, line: 1 })).toMatchObject({
          error: { code: "NVIM_WORKTREE_MISMATCH" },
          ok: false,
        });
      }
      expect(
        await channel.reveal({ buffer: targetBuffer.number, column: 1, line: 4 }),
      ).toMatchObject({
        error: { code: "NVIM_INVALID_RANGE" },
        ok: false,
      });
      expect(
        await channel.reveal({ buffer: targetBuffer.number, column: 12, line: 1 }),
      ).toMatchObject({
        error: { code: "NVIM_INVALID_RANGE" },
        ok: false,
      });
      expect(
        await nvim.executeLua(
          "return { currentWindow = vim.api.nvim_get_current_win(), currentBuffer = vim.api.nvim_get_current_buf(), windows = #vim.api.nvim_tabpage_list_wins(0) }",
          [],
        ),
      ).toEqual(beforeRejected);
      expect(await Bun.file(target).text()).toBe(targetText);
    });
  } finally {
    await Promise.all([
      rm(workspace, { force: true, recursive: true }),
      rm(outsideWorkspace, { force: true, recursive: true }),
    ]);
  }
}, 10_000);

test("owns temporary highlights through expiry, explicit removal, and channel cleanup", async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "pi-neovim-highlight-")));
  const outsideWorkspace = await realpath(
    await mkdtemp(join(tmpdir(), "pi-neovim-highlight-outside-")),
  );
  const source = join(workspace, "source.lua");
  const readonly = join(workspace, "readonly.lua");
  const outside = join(outsideWorkspace, "outside.lua");
  const diskText = "alpha æ\nbeta\n";
  await Promise.all([
    Bun.write(source, diskText),
    Bun.write(readonly, "readonly\n"),
    Bun.write(outside, "outside\n"),
  ]);
  const setup = [
    `local source_name = ${JSON.stringify(source)}`,
    `local readonly_name = ${JSON.stringify(readonly)}`,
    `local outside_name = ${JSON.stringify(outside)}`,
    'vim.cmd("edit " .. vim.fn.fnameescape(source_name))',
    "local source_buffer = vim.api.nvim_get_current_buf()",
    "vim.api.nvim_buf_set_lines(source_buffer, 0, 1, true, { 'alpha æ unsaved' })",
    "local readonly_buffer = vim.fn.bufadd(readonly_name)",
    "vim.fn.bufload(readonly_buffer)",
    "vim.bo[readonly_buffer].modifiable = false",
    "local outside_buffer = vim.fn.bufadd(outside_name)",
    "vim.fn.bufload(outside_buffer)",
    "vim.g.pi_highlight_test = { source = source_buffer, readonly = readonly_buffer, outside = outside_buffer }",
  ].join("; ");

  try {
    await withNvim(workspace, setup, async (channel, socket) => {
      const nvim = attach({ socket });
      const initial = (await nvim.executeLua(
        "local b = vim.g.pi_highlight_test.source; return { buffer = b, changedtick = vim.api.nvim_buf_get_changedtick(b), currentWindow = vim.api.nvim_get_current_win(), cursor = vim.api.nvim_win_get_cursor(0), lines = vim.api.nvim_buf_get_lines(b, 0, -1, true), modified = vim.bo[b].modified, outside = vim.g.pi_highlight_test.outside, readonly = vim.g.pi_highlight_test.readonly, windows = #vim.api.nvim_tabpage_list_wins(0) }",
        [],
      )) as {
        buffer: number;
        changedtick: number;
        currentWindow: number;
        cursor: [number, number];
        lines: string[];
        modified: boolean;
        outside: number;
        readonly: number;
        windows: number;
      };

      const temporary = await channel.highlight({
        buffer: initial.buffer,
        durationMs: 100,
        startLine: 1,
      });
      expect(temporary).toMatchObject({
        ok: true,
        value: {
          end: { column: 17, line: 1 },
          expiresInMs: 100,
          start: { column: 1, line: 1 },
        },
      });
      if (temporary.ok === false) return;
      const namespace = `PiNeovimHighlights${temporary.value.editor.channelId}`;
      expect(
        await nvim.executeLua(
          "local b, name, id = ...; local ns = vim.api.nvim_get_namespaces()[name]; local mark = vim.api.nvim_buf_get_extmark_by_id(b, ns, id, { details = true, hl_name = true }); return { mark = mark, changedtick = vim.api.nvim_buf_get_changedtick(b), currentWindow = vim.api.nvim_get_current_win(), cursor = vim.api.nvim_win_get_cursor(0), lines = vim.api.nvim_buf_get_lines(b, 0, -1, true), modified = vim.bo[b].modified, windows = #vim.api.nvim_tabpage_list_wins(0) }",
          [initial.buffer, namespace, temporary.value.highlightId],
        ),
      ).toMatchObject({
        changedtick: initial.changedtick,
        currentWindow: initial.currentWindow,
        cursor: initial.cursor,
        lines: initial.lines,
        mark: [0, 0, expect.objectContaining({ end_col: 16, end_row: 0, hl_group: "Search" })],
        modified: initial.modified,
        windows: initial.windows,
      });

      await Bun.sleep(150);
      expect(
        await nvim.executeLua(
          "local b, name, id = ...; local ns = vim.api.nvim_get_namespaces()[name]; return vim.api.nvim_buf_get_extmark_by_id(b, ns, id, {})",
          [initial.buffer, namespace, temporary.value.highlightId],
        ),
      ).toEqual([]);

      const removable = await channel.highlight({
        buffer: initial.buffer,
        durationMs: 30_000,
        endColumn: 5,
        startLine: 2,
      });
      if (removable.ok === false) throw new Error(removable.error.message);
      expect(
        await channel.clearHighlight({
          buffer: initial.buffer,
          highlightId: removable.value.highlightId,
        }),
      ).toMatchObject({ ok: true, value: { cleared: true } });
      expect(
        await channel.clearHighlight({
          buffer: initial.buffer,
          highlightId: removable.value.highlightId,
        }),
      ).toMatchObject({ ok: true, value: { cleared: false } });

      expect(
        await channel.highlight({ buffer: initial.buffer, endColumn: 1, startLine: 1 }),
      ).toMatchObject({ error: { code: "NVIM_INVALID_RANGE" }, ok: false });
      expect(
        await channel.highlight({ buffer: initial.outside, endColumn: 2, startLine: 1 }),
      ).toMatchObject({ error: { code: "NVIM_WORKTREE_MISMATCH" }, ok: false });
      expect(
        await channel.highlight({ buffer: initial.readonly, endColumn: 2, startLine: 1 }),
      ).toMatchObject({ error: { code: "NVIM_INVALID_BUFFER" }, ok: false });

      const cleanup = await channel.highlight({
        buffer: initial.buffer,
        durationMs: 30_000,
        endColumn: 5,
        startLine: 2,
      });
      if (cleanup.ok === false) throw new Error(cleanup.error.message);
      const secondChannel = new PiNeovimChannel(socket, workspace);
      const second = await secondChannel.highlight({
        buffer: initial.buffer,
        durationMs: 30_000,
        endColumn: 5,
        startLine: 2,
      });
      if (second.ok === false) throw new Error(second.error.message);
      const secondNamespace = `PiNeovimHighlights${second.value.editor.channelId}`;
      expect(secondNamespace).not.toBe(namespace);

      await channel.close();
      expect(
        await nvim.executeLua(
          "local b, first_name, first_id, second_name, second_id = ...; local namespaces = vim.api.nvim_get_namespaces(); return { first = vim.api.nvim_buf_get_extmark_by_id(b, namespaces[first_name], first_id, {}), second = vim.api.nvim_buf_get_extmark_by_id(b, namespaces[second_name], second_id, {}) }",
          [
            initial.buffer,
            namespace,
            cleanup.value.highlightId,
            secondNamespace,
            second.value.highlightId,
          ],
        ),
      ).toEqual({ first: [], second: [1, 0] });
      await secondChannel.close();
      expect(
        await nvim.executeLua(
          "local b, name, id = ...; local ns = vim.api.nvim_get_namespaces()[name]; return vim.api.nvim_buf_get_extmark_by_id(b, ns, id, {})",
          [initial.buffer, secondNamespace, second.value.highlightId],
        ),
      ).toEqual([]);
      expect(await Bun.file(source).text()).toBe(diskText);
    });
  } finally {
    await Promise.all([
      rm(workspace, { force: true, recursive: true }),
      rm(outsideWorkspace, { force: true, recursive: true }),
    ]);
  }
}, 10_000);

test("creates atomic source-anchored callouts without changing editor or buffer state", async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "pi-neovim-annotations-")));
  const outsideWorkspace = await realpath(
    await mkdtemp(join(tmpdir(), "pi-neovim-annotations-outside-")),
  );
  const source = join(workspace, "source.lua");
  const readonly = join(workspace, "readonly.lua");
  const outside = join(outsideWorkspace, "outside.lua");
  const diskText =
    "local shifted = true\nlocal target = call()\nreturn target\nduplicate duplicate\n";
  await Promise.all([
    Bun.write(source, diskText),
    Bun.write(readonly, "readonly\n"),
    Bun.write(outside, "outside\n"),
  ]);
  const setup = [
    `local source_name = ${JSON.stringify(source)}`,
    `local readonly_name = ${JSON.stringify(readonly)}`,
    `local outside_name = ${JSON.stringify(outside)}`,
    'vim.cmd("edit " .. vim.fn.fnameescape(source_name))',
    "local source_buffer = vim.api.nvim_get_current_buf()",
    "vim.api.nvim_buf_set_lines(source_buffer, 0, 0, true, { '-- æ unsaved' })",
    "vim.api.nvim_win_set_cursor(0, { 2, 3 })",
    "local readonly_buffer = vim.fn.bufadd(readonly_name)",
    "vim.fn.bufload(readonly_buffer)",
    "vim.bo[readonly_buffer].modifiable = false",
    "local outside_buffer = vim.fn.bufadd(outside_name)",
    "vim.fn.bufload(outside_buffer)",
    "vim.g.pi_annotation_test = { source = source_buffer, readonly = readonly_buffer, outside = outside_buffer }",
  ].join("; ");

  try {
    await withNvim(workspace, setup, async (channel, socket) => {
      const nvim = attach({ socket });
      const initial = (await nvim.executeLua(
        "local b = vim.g.pi_annotation_test.source; return { buffer = b, changedtick = vim.api.nvim_buf_get_changedtick(b), currentWindow = vim.api.nvim_get_current_win(), cursor = vim.api.nvim_win_get_cursor(0), lines = vim.api.nvim_buf_get_lines(b, 0, -1, true), modified = vim.bo[b].modified, outside = vim.g.pi_annotation_test.outside, readonly = vim.g.pi_annotation_test.readonly, windows = #vim.api.nvim_tabpage_list_wins(0) }",
        [],
      )) as {
        buffer: number;
        changedtick: number;
        currentWindow: number;
        cursor: [number, number];
        lines: string[];
        modified: boolean;
        outside: number;
        readonly: number;
        windows: number;
      };
      const shiftedAnnotation = {
        anchor: "return target",
        kind: "note" as const,
        line: 2,
        text: "Result exits here",
      };
      const targetAnnotation = {
        anchor: "target = call",
        kind: "warning" as const,
        line: 3,
        text: "Review this call",
      };
      const annotations = [shiftedAnnotation, targetAnnotation];
      const result = await channel.annotate({
        annotations,
        buffer: initial.buffer,
        durationMs: 100,
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          annotations: [
            {
              column: 7,
              inputIndex: 2,
              kind: "warning",
              line: 3,
              placement: "callout",
              text: "Review this call",
            },
            {
              column: 1,
              inputIndex: 1,
              kind: "note",
              line: 4,
              placement: "callout",
              text: "Result exits here",
            },
          ],
          expiresInMs: 100,
        },
      });
      if (result.ok === false) return;
      const namespace = `PiNeovimAnnotations${result.value.editor.channelId}`;
      expect(
        await nvim.executeLua(
          "local b, name = ...; local ns = vim.api.nvim_get_namespaces()[name]; local marks = vim.api.nvim_buf_get_extmarks(b, ns, 0, -1, { details = true, hl_name = true }); return { marks = marks, changedtick = vim.api.nvim_buf_get_changedtick(b), currentWindow = vim.api.nvim_get_current_win(), cursor = vim.api.nvim_win_get_cursor(0), lines = vim.api.nvim_buf_get_lines(b, 0, -1, true), modified = vim.bo[b].modified, windows = #vim.api.nvim_tabpage_list_wins(0) }",
          [initial.buffer, namespace],
        ),
      ).toMatchObject({
        changedtick: initial.changedtick,
        currentWindow: initial.currentWindow,
        cursor: initial.cursor,
        lines: initial.lines,
        marks: [
          [
            result.value.annotations[0]?.annotationId,
            2,
            6,
            expect.objectContaining({
              virt_lines: [
                [
                  ["└──── ", "DiagnosticWarn"],
                  ["Review this call", "DiagnosticWarn"],
                ],
              ],
            }),
          ],
          [
            result.value.annotations[1]?.annotationId,
            3,
            0,
            expect.objectContaining({
              virt_lines: [
                [
                  ["└──── ", "DiagnosticInfo"],
                  ["Result exits here", "DiagnosticInfo"],
                ],
              ],
            }),
          ],
        ],
        modified: initial.modified,
        windows: initial.windows,
      });

      await Bun.sleep(150);
      expect(
        await nvim.executeLua(
          "local b, name = ...; local ns = vim.api.nvim_get_namespaces()[name]; return vim.api.nvim_buf_get_extmarks(b, ns, 0, -1, {})",
          [initial.buffer, namespace],
        ),
      ).toEqual([]);

      expect(
        await channel.annotate({
          annotations: [
            shiftedAnnotation,
            { anchor: "missing source", kind: "error", line: 3, text: "Must not remain" },
          ],
          buffer: initial.buffer,
        }),
      ).toMatchObject({ error: { code: "NVIM_STALE_ANCHOR" }, ok: false });
      expect(
        await channel.annotate({
          annotations: [{ anchor: "duplicate", kind: "error", line: 1, text: "Ambiguous source" }],
          buffer: initial.buffer,
        }),
      ).toMatchObject({ error: { code: "NVIM_AMBIGUOUS_ANCHOR" }, ok: false });
      expect(
        await nvim.executeLua(
          "local b, name = ...; local ns = vim.api.nvim_get_namespaces()[name]; return vim.api.nvim_buf_get_extmarks(b, ns, 0, -1, {})",
          [initial.buffer, namespace],
        ),
      ).toEqual([]);
      expect(
        await channel.annotate({
          annotations: [shiftedAnnotation],
          buffer: initial.readonly,
        }),
      ).toMatchObject({ error: { code: "NVIM_INVALID_BUFFER" }, ok: false });
      expect(
        await channel.annotate({
          annotations: [shiftedAnnotation],
          buffer: initial.outside,
        }),
      ).toMatchObject({ error: { code: "NVIM_WORKTREE_MISMATCH" }, ok: false });

      await nvim.executeLua(
        "_G.pi_original_set_extmark = vim.api.nvim_buf_set_extmark; _G.pi_set_extmark_calls = 0; vim.api.nvim_buf_set_extmark = function(...) _G.pi_set_extmark_calls = _G.pi_set_extmark_calls + 1; if _G.pi_set_extmark_calls == 2 then error('forced extmark failure') end; return _G.pi_original_set_extmark(...) end",
        [],
      );
      const partial = await channel.annotate({ annotations, buffer: initial.buffer });
      await nvim.executeLua(
        "vim.api.nvim_buf_set_extmark = _G.pi_original_set_extmark; _G.pi_original_set_extmark = nil; _G.pi_set_extmark_calls = nil",
        [],
      );
      expect(partial).toMatchObject({ error: { code: "NVIM_INVALID_RESPONSE" }, ok: false });
      expect(
        await nvim.executeLua(
          "local b, name = ...; local ns = vim.api.nvim_get_namespaces()[name]; return vim.api.nvim_buf_get_extmarks(b, ns, 0, -1, {})",
          [initial.buffer, namespace],
        ),
      ).toEqual([]);

      await nvim.executeLua(
        "local b, count = ...; local lines = {}; for index = 1, count do lines[index] = '-- filler ' .. index end; vim.api.nvim_buf_set_lines(b, -1, -1, true, lines)",
        [initial.buffer, MAX_ANNOTATION_SEARCH_LINES - initial.lines.length + 1],
      );
      expect(
        await channel.annotate({
          annotations: [shiftedAnnotation],
          buffer: initial.buffer,
        }),
      ).toMatchObject({ error: { code: "NVIM_LIMIT_EXCEEDED" }, ok: false });

      const cleanup = await channel.annotate({
        annotations: [targetAnnotation],
        buffer: initial.buffer,
        durationMs: 30_000,
      });
      if (cleanup.ok === false) throw new Error(cleanup.error.message);
      const repeated = Array.from({ length: 10 }, () => targetAnnotation);
      for (let index = 0; index < 4; index += 1) {
        expect(
          await channel.annotate({
            annotations: repeated,
            buffer: initial.buffer,
            durationMs: 30_000,
          }),
        ).toMatchObject({ ok: true });
      }
      expect(
        await channel.annotate({
          annotations: repeated.slice(0, 9),
          buffer: initial.buffer,
          durationMs: 30_000,
        }),
      ).toMatchObject({ ok: true });
      expect(
        await channel.annotate({
          annotations: [targetAnnotation],
          buffer: initial.buffer,
          durationMs: 30_000,
        }),
      ).toMatchObject({ error: { code: "NVIM_LIMIT_EXCEEDED" }, ok: false });

      await channel.close();
      expect(
        await nvim.executeLua(
          "local b, name = ...; local ns = vim.api.nvim_get_namespaces()[name]; return vim.api.nvim_buf_get_extmarks(b, ns, 0, -1, {})",
          [initial.buffer, namespace],
        ),
      ).toEqual([]);
      expect(await Bun.file(source).text()).toBe(diskText);
    });
  } finally {
    await Promise.all([
      rm(workspace, { force: true, recursive: true }),
      rm(outsideWorkspace, { force: true, recursive: true }),
    ]);
  }
}, 10_000);

test("rejects oversized problem lists and special-buffer locations", async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "pi-neovim-quickfix-limits-")));
  const source = join(workspace, "source.lua");
  await Bun.write(source, "return true\n");
  const setup = [
    `local source_name = ${JSON.stringify(source)}`,
    'vim.cmd("edit " .. vim.fn.fnameescape(source_name))',
    "local owner_window = vim.api.nvim_get_current_win()",
    "local source_buffer = vim.api.nvim_get_current_buf()",
    "local items = {}",
    `for index = 1, ${MAX_QUICKFIX_SOURCE_ITEMS + 1} do items[index] = { bufnr = source_buffer, lnum = 1, col = 1, text = 'problem ' .. index } end`,
    "vim.fn.setqflist({}, 'r', { items = items })",
    "local special = vim.api.nvim_create_buf(true, true)",
    'vim.api.nvim_buf_set_name(special, "term:///outside/special")',
    "vim.fn.setloclist(owner_window, {}, 'r', { items = { { bufnr = special, lnum = 1, col = 1, text = 'special' } } })",
  ].join("; ");

  try {
    await withNvim(workspace, setup, async (channel) => {
      expect(await channel.quickfix()).toMatchObject({
        error: { code: "NVIM_LIMIT_EXCEEDED" },
        ok: false,
      });
      const visible = await channel.visibleWindows();
      if (visible.ok === false) throw new Error(visible.error.message);
      expect(
        await channel.quickfix({
          kind: "location",
          window: visible.value.windows[0]?.number ?? 0,
        }),
      ).toMatchObject({
        error: { code: "NVIM_INVALID_RESPONSE" },
        ok: false,
      });
    });
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
}, 10_000);

test("rejects stale preserved source identity without reading another buffer", async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "pi-neovim-stale-diagnostic-")));
  const source = join(workspace, "source.lua");
  await Bun.write(source, "return true\n");
  const setup = [
    `local source_name = ${JSON.stringify(source)}`,
    'vim.cmd("edit " .. vim.fn.fnameescape(source_name))',
    "local source = vim.api.nvim_get_current_buf()",
    `require('plugins.ai.pi.bridge').record_source_context({ buffer = { number = source, name = ${JSON.stringify(join(workspace, "different.lua"))} } })`,
    "local terminal = vim.api.nvim_create_buf(false, true)",
    'vim.api.nvim_buf_set_name(terminal, "pi-terminal-must-not-leak")',
    "vim.b[terminal].is_pi_terminal = true",
    "vim.api.nvim_set_current_buf(terminal)",
  ].join("; ");

  try {
    await withNvim(workspace, setup, async (channel) => {
      expect(await channel.diagnosticSummary()).toMatchObject({
        error: { code: "NVIM_INVALID_BUFFER" },
        ok: false,
      });
      expect(await channel.status()).toMatchObject({ ok: true });
    });
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
}, 10_000);

test("limits complete diagnostics while preserving bounded summaries", async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "pi-neovim-diagnostic-limit-")));
  const source = join(workspace, "many-diagnostics.lua");
  await Bun.write(source, "return true\n");
  const setup = [
    `local source_name = ${JSON.stringify(source)}`,
    'vim.cmd("edit " .. vim.fn.fnameescape(source_name))',
    "local diagnostics = {}",
    "for index = 1, 501 do diagnostics[index] = { lnum = 0, col = 0, severity = vim.diagnostic.severity.ERROR, message = 'diagnostic ' .. index, source = 'limit-test' } end",
    "vim.diagnostic.set(vim.api.nvim_create_namespace('pi-diagnostic-limit'), 0, diagnostics)",
  ].join("; ");

  try {
    await withNvim(workspace, setup, async (channel) => {
      expect(await channel.diagnostics()).toMatchObject({
        error: { code: "NVIM_LIMIT_EXCEEDED" },
        ok: false,
      });
      expect(await channel.diagnosticSummary({ maxItems: 1 })).toMatchObject({
        ok: true,
        value: {
          counts: { error: 501, total: 501 },
          diagnostics: [expect.objectContaining({ severity: "error" })],
          truncated: true,
        },
      });
    });
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
}, 10_000);

test("rejects visible, listed, read, and diagnostic content outside the bound worktree", async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "pi-neovim-bound-")));
  const sibling = await realpath(await mkdtemp(join(tmpdir(), "pi-neovim-sibling-")));
  const outsideSource = join(sibling, "outside.lua");
  await Bun.write(outsideSource, "return 'outside'\n");
  const setup = [
    `local outside_source = ${JSON.stringify(outsideSource)}`,
    'vim.cmd("edit " .. vim.fn.fnameescape(outside_source))',
    "vim.fn.setqflist({}, 'r', { items = { { bufnr = vim.api.nvim_get_current_buf(), lnum = 1, col = 1, text = 'outside' } } })",
  ].join("; ");

  try {
    await withNvim(workspace, setup, async (channel) => {
      expect(await channel.visibleWindows()).toMatchObject({
        error: { code: "NVIM_WORKTREE_MISMATCH" },
        ok: false,
      });
      expect(await channel.listBuffers()).toMatchObject({
        error: { code: "NVIM_WORKTREE_MISMATCH" },
        ok: false,
      });
      expect(await channel.readBuffer({ buffer: 1 })).toMatchObject({
        error: { code: "NVIM_WORKTREE_MISMATCH" },
        ok: false,
      });
      expect(await channel.diagnosticSummary({ buffer: 1 })).toMatchObject({
        error: { code: "NVIM_WORKTREE_MISMATCH" },
        ok: false,
      });
      expect(await channel.diagnostics(1)).toMatchObject({
        error: { code: "NVIM_WORKTREE_MISMATCH" },
        ok: false,
      });
      expect(await channel.quickfix()).toMatchObject({
        error: { code: "NVIM_WORKTREE_MISMATCH" },
        ok: false,
      });
    });
  } finally {
    await Promise.all([
      rm(workspace, { force: true, recursive: true }),
      rm(sibling, { force: true, recursive: true }),
    ]);
  }
}, 10_000);
