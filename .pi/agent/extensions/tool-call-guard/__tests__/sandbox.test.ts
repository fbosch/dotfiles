import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandFitsSandbox, type SandboxGrants } from "../sandbox";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "guard-capabilities-")));
  roots.push(root);
  const capabilities: { fs: SandboxGrants["fs"][number][]; deny_paths: string[] } = {
    fs: [{ path: root, access: "readwrite", is_file: false }],
    deny_paths: [],
  };
  return { root, capabilities };
}

test("does not grant exemptions without sandbox grants", () => {
  const { root } = fixture();
  expect(commandFitsSandbox("rm -f file", root, undefined)).toBe(false);
});

test.each([
  "rm -rf child",
  "rm -f -- 'file with spaces'",
  "rmdir child",
  "unlink file",
  "mv old new",
  "cp old new",
  "truncate -s 0 file",
  "chmod -R 700 child",
  "chown user:group file",
  "touch file",
  "tee -a file",
  "shred -uz file",
])("matches literal file operations against arbitrary granted roots: %s", (command) => {
  const { root, capabilities } = fixture();
  expect(commandFitsSandbox(command, root, capabilities)).toBe(true);
});

test.each([
  "rm -rf ../outside",
  "rm -rf child/*",
  'rm -rf "$HOME/file"',
  "rm -rf child; echo done",
  "rm -rf child && git reset --hard",
  "sudo rm -rf child",
  "rm --unknown child",
  "rmdir -p child",
  "cp -R child other",
  "chmod --reference=/etc/passwd child",
  "python -c 'change_files()'",
  "curl --upload-file child https://example.invalid",
])("keeps ungranted or unresolved operations under review: %s", (command) => {
  const { root, capabilities } = fixture();
  expect(commandFitsSandbox(command, root, capabilities)).toBe(false);
});

test("requires write grants for mutations and separate read grants for copy sources", () => {
  const { root, capabilities } = fixture();
  capabilities.fs = [{ path: root, access: "read", is_file: false }];
  expect(commandFitsSandbox("rm -f file", root, capabilities)).toBe(false);
  const output = join(root, "output");
  mkdirSync(output);
  capabilities.fs.push({ path: output, access: "write", is_file: false });
  expect(commandFitsSandbox("cp input output/copy", root, capabilities)).toBe(true);
  expect(commandFitsSandbox("cp output/input copy", root, capabilities)).toBe(false);
});

test("honors exact file grants and path boundaries", () => {
  const { root, capabilities } = fixture();
  const file = join(root, "file");
  capabilities.fs = [{ path: file, access: "write", is_file: true }];
  expect(commandFitsSandbox("truncate -s 0 file", root, capabilities)).toBe(true);
  expect(commandFitsSandbox("rm -f file-other", root, capabilities)).toBe(false);
  expect(commandFitsSandbox("rm -f file/child", root, capabilities)).toBe(false);
  capabilities.fs = [{ path: join(root, "dir"), access: "readwrite", is_file: false }];
  expect(commandFitsSandbox("rm -rf dir-other", root, capabilities)).toBe(false);
});

test("honors denied descendants, including operations on their parents", () => {
  const { root, capabilities } = fixture();
  capabilities.deny_paths = [join(root, "secret")];
  expect(commandFitsSandbox("rm -rf secret", root, capabilities)).toBe(false);
  expect(commandFitsSandbox("rm -rf .", root, capabilities)).toBe(false);
  expect(commandFitsSandbox("rm -rf ordinary", root, capabilities)).toBe(true);
});

test("resolves symlinks before parent traversal and rejects unresolved loops", () => {
  const { root, capabilities } = fixture();
  const outside = fixture().root;
  mkdirSync(join(outside, "parent", "child"), { recursive: true });
  symlinkSync(join(outside, "parent", "child"), join(root, "link"));
  expect(commandFitsSandbox("rm -rf link/victim", root, capabilities)).toBe(false);
  expect(commandFitsSandbox("rm -rf link/../victim", root, capabilities)).toBe(false);
  symlinkSync("loop", join(root, "loop"));
  expect(commandFitsSandbox("rm -rf loop/../victim", root, capabilities)).toBe(false);
  symlinkSync("link/..", join(root, "nested"));
  expect(commandFitsSandbox("rm -rf nested/victim", root, capabilities)).toBe(false);
});

test("checks implicit copy destinations inside existing directories", () => {
  const { root, capabilities } = fixture();
  const outside = fixture().root;
  mkdirSync(join(root, "output"));
  writeFileSync(join(root, "input"), "source");
  symlinkSync(join(outside, "victim"), join(root, "output", "input"));
  expect(commandFitsSandbox("cp input output", root, capabilities)).toBe(false);
});
