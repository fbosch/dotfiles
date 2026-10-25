import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import sandbox from "../index";

const initial = process.env.NONO_CAP_FILE;
const roots: string[] = [];
afterEach(() => {
  if (initial === undefined) delete process.env.NONO_CAP_FILE;
  else process.env.NONO_CAP_FILE = initial;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function register() {
  let handler: ((args: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined;
  sandbox({
    on: () => () => {},
    registerCommand: (_name: string, command: { handler: typeof handler }) => {
      handler = command.handler;
    },
  } as unknown as ExtensionAPI);
  const notices: Array<{ message: string; level: string }> = [];
  const ctx = {
    cwd: "/",
    ui: { notify: (message: string, level: string) => notices.push({ message, level }) },
  } as unknown as ExtensionCommandContext;
  return { run: (args: string) => handler?.(args, ctx), notices };
}

test("reports missing metadata without an error", async () => {
  delete process.env.NONO_CAP_FILE;
  const { run, notices } = register();
  await run("");
  expect(notices).toEqual([
    { message: expect.stringContaining("No readable nono capability metadata"), level: "info" },
  ]);
});

test("reads the live capability file and explains a path", async () => {
  const root = mkdtempSync(join(tmpdir(), "sandbox-command-"));
  roots.push(root);
  const file = join(root, "caps.json");
  writeFileSync(
    file,
    JSON.stringify({
      fs: [{ path: "/tmp", access: "readwrite", is_file: false, source: "profile" }],
      deny_paths: [],
      applied_bypasses: [],
      allowed_commands: [],
      blocked_commands: [],
      allowed_domains: [],
      net_blocked: true,
    }),
  );
  process.env.NONO_CAP_FILE = file;
  const { run, notices } = register();
  await run("");
  await run("explain /tmp/x");
  await run("bogus");
  expect(notices[0]?.message).toContain("Network: blocked");
  expect(notices[1]?.message).toContain("Allowed (write)");
  expect(notices[2]).toMatchObject({
    level: "warning",
    message: expect.stringContaining("Usage:"),
  });
});
