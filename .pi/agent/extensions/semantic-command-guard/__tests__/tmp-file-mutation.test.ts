import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { isTmpFileMutation } from "../tmp-file-mutation";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test.each([
  "rm -rf /tmp/guard-test-missing",
  "rm -- '/tmp/guard test missing'",
  "rmdir /tmp/guard-test-dir",
  "unlink /tmp/guard-test-file",
  "mv -f /tmp/guard-test-old /tmp/guard-test-new",
  "truncate -s 0 /tmp/guard-test-file",
  "chmod -R 700 /tmp/guard-test-dir",
  "chown user:group /tmp/guard-test-file",
  "touch /tmp/guard-test-file",
  "tee -a /tmp/guard-test-file",
  "shred -uz /tmp/guard-test-file",
])("exempts literal /tmp mutations: %s", (command) => {
  expect(isTmpFileMutation(command, "/")).toBe(true);
});

test.each([
  "rm -rf /tmp",
  "rm -rf /tmp/../etc/file",
  "rm -f /tmp/guard-test-file /etc/file",
  "mv /tmp/guard-test-file /etc/file",
  "rm -rf /tmp/*",
  'rm -rf "$TMPDIR/file"',
  "rm -f /tmp/file; rm -f /etc/file",
  "sudo rm -f /tmp/file",
  "rmdir -p /tmp/file",
  "truncate --reference /etc/file /tmp/file",
  "chmod --reference=/etc/file /tmp/file",
  'python -c \'open("/tmp/file", "w")\'',
])("keeps ambiguous or out-of-scope commands under review: %s", (command) => {
  expect(isTmpFileMutation(command, "/")).toBe(false);
});

test("resolves relative targets and rejects symlink escapes", () => {
  const root = mkdtempSync("/tmp/command-guard-");
  roots.push(root);
  expect(isTmpFileMutation("rm -f missing", root)).toBe(true);
  symlinkSync("/etc", join(root, "outside"));
  expect(isTmpFileMutation(`rm -f ${root}/outside/file`, "/")).toBe(false);
  expect(isTmpFileMutation(`truncate -s 0 ${root}/outside/file`, "/")).toBe(false);
  expect(isTmpFileMutation(`rm -f ${root}/outside/../file`, "/")).toBe(false);
});
