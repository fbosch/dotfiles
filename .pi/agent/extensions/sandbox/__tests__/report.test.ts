import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NonoCapabilities } from "../../../lib/nono-capabilities";
import { explain, list, parseRequest, summarize } from "../report";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-report-")));
  roots.push(root);
  const capabilities: NonoCapabilities = {
    fs: [
      { path: root, access: "readwrite", is_file: false, source: "user" },
      { path: "/nix/store", access: "read", is_file: false, source: "group:nix_runtime" },
      { path: "/etc/hosts", access: "read", is_file: true, source: "group:system_read_linux_core" },
    ],
    deny_paths: [join(root, "secret")],
    applied_bypasses: [{ path: join(root, "secret", "public"), is_file: true, removed_denies: [] }],
    allowed_commands: [],
    blocked_commands: ["rm", "mv"],
    allowed_domains: ["example.invalid"],
    net_blocked: false,
  };
  return { root, capabilities };
}

test("summary names writable roots, counts read-only sources, and states the limits", () => {
  const { root, capabilities } = fixture();
  const text = summarize(capabilities);
  expect(text).toContain(`${root}/  [readwrite, user]`);
  expect(text).toContain(
    "Read-only: 2 grants (group:nix_runtime 1, group:system_read_linux_core 1)",
  );
  expect(text).toContain("Denied paths: 1; applied exceptions: 1");
  expect(text).toContain("Commands: 2 blocked, 0 explicitly allowed");
  expect(text).toContain("Network: not blocked");
  expect(text).toContain("not verified confinement");
});

test.each([
  ["write", "readwrite"],
  ["read", "/nix/store/  [read, group:nix_runtime]"],
  ["denied", "/secret"],
  ["exceptions", "public"],
  ["commands", "blocked  rm"],
  ["domains", "example.invalid"],
] as const)("lists %s entries", (topic, expected) => {
  expect(list(fixture().capabilities, topic)).toContain(expected);
});

test("lists readwrite grants under read and reports empty sections", () => {
  const { root, capabilities } = fixture();
  expect(list(capabilities, "read")).toContain(root);
  expect(list({ ...capabilities, allowed_domains: [] }, "domains")).toContain("none");
});

test("explains granted, ungranted, denied, and relative paths", () => {
  const { root, capabilities } = fixture();
  expect(explain(capabilities, root, `${root}/file`, "write")).toContain("Allowed (write)");
  expect(explain(capabilities, root, "child/file", "write")).toContain(`${root}/child/file`);
  expect(explain(capabilities, root, "/etc/hosts", "read")).toContain("Allowed (read)");
  expect(explain(capabilities, root, "/etc/hosts", "write")).toContain("Not granted (write)");
  expect(explain(capabilities, root, "/var/other", "read")).toContain("Not granted (read)");
  expect(explain(capabilities, root, "secret/key", "read")).toContain("Overlaps denied path");
  expect(explain(capabilities, root, ".", "write")).toContain("Overlaps denied path");
});

test("resolves symlinks before judging access and expands home", () => {
  const { root, capabilities } = fixture();
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-outside-")));
  roots.push(outside);
  symlinkSync(outside, join(root, "link"));
  expect(explain(capabilities, root, "link/file", "write")).toContain("Not granted (write)");
  mkdirSync(join(root, "home"));
  expect(explain(capabilities, root, "~/file", "write", join(root, "home"))).toContain(
    `${root}/home/file`,
  );
});

test("parses requests and rejects malformed ones", () => {
  expect(parseRequest("")).toEqual({ kind: "summary" });
  expect(parseRequest(" list denied ")).toEqual({ kind: "list", topic: "denied" });
  expect(parseRequest("explain /tmp/x")).toEqual({
    kind: "explain",
    target: "/tmp/x",
    access: "write",
  });
  expect(parseRequest("explain /tmp/x read")).toEqual({
    kind: "explain",
    target: "/tmp/x",
    access: "read",
  });
  expect(parseRequest("explain my file read")).toEqual({
    kind: "explain",
    target: "my file",
    access: "read",
  });
  for (const args of [
    "list",
    "list nope",
    "list denied extra",
    "explain",
    "explain read",
    "other",
  ]) {
    expect(parseRequest(args)).toEqual({ kind: "invalid" });
  }
});
