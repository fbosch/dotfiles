import { expect, test } from "bun:test";
import { access, rm } from "node:fs/promises";
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
