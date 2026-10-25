import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nonoCapabilityFile, readNonoCapabilities } from "../nono-capabilities";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const VALID = {
  fs: [
    { original: "/tmp", path: "/tmp", access: "readwrite", is_file: false, source: "profile" },
    { path: "/etc/hosts", access: "read", is_file: true, source: "group:x", dev: 1, ino: 2 },
  ],
  net_blocked: false,
  allowed_commands: ["git"],
  blocked_commands: ["rm"],
  applied_bypasses: [
    { path: "/home/u/.ssh/config", access: "Read", is_file: true, removed_denies: [] },
  ],
  deny_paths: ["/home/u/.ssh"],
  allowed_domains: ["example.invalid"],
};

function write(contents: unknown): string {
  const root = mkdtempSync(join(tmpdir(), "nono-capabilities-"));
  roots.push(root);
  const path = join(root, "capabilities.json");
  writeFileSync(path, typeof contents === "string" ? contents : JSON.stringify(contents));
  return path;
}

test("parses grants, denies, exceptions, command lists, and network settings", () => {
  expect(readNonoCapabilities(write(VALID))).toEqual({
    fs: [
      { path: "/tmp", access: "readwrite", is_file: false, source: "profile" },
      { path: "/etc/hosts", access: "read", is_file: true, source: "group:x" },
    ],
    deny_paths: ["/home/u/.ssh"],
    applied_bypasses: [{ path: "/home/u/.ssh/config", is_file: true, removed_denies: [] }],
    allowed_commands: ["git"],
    blocked_commands: ["rm"],
    allowed_domains: ["example.invalid"],
    net_blocked: false,
  });
});

test.each([
  ["not json", "not-json"],
  ["null", "null"],
  ["empty object", {}],
  [
    "unknown access",
    { ...VALID, fs: [{ path: "/tmp", access: "execute", is_file: false, source: "x" }] },
  ],
  [
    "relative grant",
    { ...VALID, fs: [{ path: "tmp", access: "read", is_file: false, source: "x" }] },
  ],
  ["missing grant source", { ...VALID, fs: [{ path: "/tmp", access: "read", is_file: false }] }],
  ["relative deny", { ...VALID, deny_paths: ["relative"] }],
  ["non-string command", { ...VALID, blocked_commands: [1] }],
  ["malformed bypass", { ...VALID, applied_bypasses: [{ path: "/x" }] }],
  ["missing network flag", { ...VALID, net_blocked: undefined }],
])("rejects malformed metadata: %s", (_name, contents) => {
  expect(readNonoCapabilities(write(contents))).toBeUndefined();
});

test.each(["", "relative.json", "/missing/nono.json"])(
  "returns undefined when the capability file is unavailable: %p",
  (capFile) => {
    expect(readNonoCapabilities(capFile)).toBeUndefined();
  },
);

test("reads the marker from the environment", () => {
  expect(nonoCapabilityFile({ NONO_CAP_FILE: "/native/nono.json" })).toBe("/native/nono.json");
  expect(nonoCapabilityFile({ NONO_CAP_FILE: "" })).toBeUndefined();
  expect(nonoCapabilityFile({})).toBeUndefined();
});
