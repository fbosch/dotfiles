import { expect, test } from "bun:test";
import { access, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiNeovimChannel } from "../channel";

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
  run: (channel: PiNeovimChannel) => Promise<void>,
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
      `lua ${setup}`,
      "--listen",
      socket,
    ],
    { cwd, stderr: "ignore", stdout: "ignore" },
  );
  const channel = new PiNeovimChannel(socket, cwd);

  try {
    await waitForSocket(socket);
    await run(channel);
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
    "vim.g.pi_launch_source_context = { pid = vim.fn.getpid(), cwd = vim.fn.getcwd(), buffer = { number = source, name = vim.api.nvim_buf_get_name(source), loaded = true, filetype = vim.bo[source].filetype, buftype = vim.bo[source].buftype, modified = vim.bo[source].modified }, cursor = { line = 1, column = 1 } }",
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
      `lua ${setup}`,
      "--listen",
      socket,
    ],
    { cwd, stderr: "ignore", stdout: "ignore" },
  );
  const channel = new PiNeovimChannel(socket, cwd);

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
  } finally {
    await channel.close();
    nvim.kill();
    await nvim.exited;
    await rm(socket, { force: true });
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

test("rejects visible, listed, and read content outside the bound worktree", async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "pi-neovim-bound-")));
  const sibling = await realpath(await mkdtemp(join(tmpdir(), "pi-neovim-sibling-")));
  const outsideSource = join(sibling, "outside.lua");
  await Bun.write(outsideSource, "return 'outside'\n");
  const setup = [
    `local outside_source = ${JSON.stringify(outsideSource)}`,
    'vim.cmd("edit " .. vim.fn.fnameescape(outside_source))',
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
    });
  } finally {
    await Promise.all([
      rm(workspace, { force: true, recursive: true }),
      rm(sibling, { force: true, recursive: true }),
    ]);
  }
}, 10_000);
