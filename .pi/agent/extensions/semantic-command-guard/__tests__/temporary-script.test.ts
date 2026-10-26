import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandFitsSandbox, type SandboxGrants } from "../sandbox";

const parent = realpathSync(mkdtempSync(join(tmpdir(), "guard-script-")));
afterAll(() => rmSync(parent, { recursive: true, force: true }));
const capabilities: SandboxGrants = {
  fs: [{ path: parent, access: "readwrite", is_file: false }],
  deny_paths: [],
};
const start = `T=$(mktemp -d ${parent}/test.XXXXXX)`;
const fits = (command: string, grants: SandboxGrants | undefined = capabilities) =>
  commandFitsSandbox(command, "/", grants);

test.each([
  `${start} && chmod 700 "$T" && touch "$T/file" && rm -rf "$T"`,
  `${start} && truncate -s 0 "${"$"}{T}/file" &&\nshred -uz "$T/file" &&\nrm -rf "$T"`,
  `tmp=$(mktemp -d ${parent}/test.XXXXXX) && touch "$tmp/file" && rm -rf "${"$"}{tmp}"`,
  `${start} && chmod -R 700 "$T" && rm -rf -- "$T"`,
])("exempts bounded temporary-directory file scripts: %s", (command) => {
  expect(fits(command)).toBe(true);
});

test.each([
  `${start} && chmod 700 "$T"; touch "$T/file"; rm -rf "$T"`,
  `${start} && chmod 777 "$T" && truncate -s 0 "$T/file"`,
  `${start} && chown other "$T" && truncate -s 0 "$T/file"`,
  `${start} && touch $T/file && rm -rf $T`,
  `${start} && touch "${"$"}{T:-/outside}/file" && rm -rf "$T"`,
  `${start} && touch "$T/file" && mv /outside "$T/file" && chmod 600 "$T/file"`,
  `${start} && cp /outside "$T/file" && rm -rf "$T"`,
  `${start} && ln -s /outside "$T/link" && truncate -s 0 "$T/link"`,
  `${start} && gpg --quick-gen-key Test && rm -rf "$T"`,
  `${start}; rm -rf "$T"`,
  `${start}\nrm -rf "$T/file"`,
  `${start} || rm -rf "$T"`,
  `${start} && rm -rf "$T" /outside`,
  `${start} && rm -rf "$T/../outside"`,
  `${start} && rm -rf "$T"/file`,
  `${start} && rm -rf '$T'`,
  `${start} && rm -rf "$T"*`,
  `${start} && rm -rf "$T" > /outside`,
  `${start} && rm -rf "$T" | sh`,
  `${start} && rm -rf "$T"; curl https://example.invalid`,
  `${start} && T=/outside; rm -rf "$T"`,
  `${start} && touch "$T/file"; mv /outside "$T/file"; chmod 600 "$T/file"`,
  `${start} && cp /outside "$T/file"; rm -rf "$T"`,
  `${start} && ln -s /outside "$T/link"; truncate -s 0 "$T/link"`,
  `${start} && gpg --quick-gen-key Test; rm -rf "$T"`,
  `${start} && rm --unknown "$T"`,
  `${start} && rm -rf "$T"; echo done`,
  `${start} && rm -rf "$T";`,
  `${start} && rm -rf "$T" &`,
  `${start} && rm -rf "$T"; # comment\nrm -rf /outside`,
  `${start} && rm -rf "$T"\r\n`,
  `${start} && rm -rf "$T/$(echo outside)"`,
  `${start} && rm -rf "$T/../"`,
  `${start} && rm -rf "$T//file"`,
  `${start} && chmod --reference=/outside "$T"`,
  `PATH=$(mktemp -d ${parent}/test.XXXXXX) && rm -rf "$PATH"`,
  `_=$(mktemp -d ${parent}/test.XXXXXX) && rm -rf "$_"`,
  'T=$(mktemp -d) && rm -rf "$T"',
  'T=$(mktemp -d relative.XXXXXX) && rm -rf "$T"',
  `T=$(mktemp -u -d ${parent}/test.XXXXXX) && rm -rf "$T"`,
])("keeps unresolved or escaping temporary scripts under review: %s", (command) => {
  expect(fits(command)).toBe(false);
});

test("requires a writable directory grant covering the entire temporary parent", () => {
  const command = `${start} && rm -rf "$T"`;
  expect(commandFitsSandbox(command, "/", undefined)).toBe(false);
  expect(fits(command, { ...capabilities, fs: [] })).toBe(false);
  expect(
    fits(command, {
      ...capabilities,
      fs: [{ path: parent, access: "read", is_file: false }],
    }),
  ).toBe(false);
  expect(
    fits(command, {
      ...capabilities,
      fs: [{ path: parent, access: "write", is_file: true }],
    }),
  ).toBe(false);
  expect(
    fits(command, {
      ...capabilities,
      deny_paths: [`${parent}/secret`],
    }),
  ).toBe(false);
});

test("resolves a symlinked template parent before matching grants", () => {
  const link = join(parent, "escape");
  symlinkSync("/", link);
  expect(fits(`T=$(mktemp -d ${link}/test.XXXXXX) && rm -rf "$T"`)).toBe(false);
});

test("accepts directory write grants without requiring read access", () => {
  expect(
    fits(`${start} && rm -rf "$T"`, {
      ...capabilities,
      fs: [{ path: parent, access: "write", is_file: false }],
    }),
  ).toBe(true);
});

test.each([0, 1])("runs file operations only when mktemp succeeds: status %s", (status) => {
  const command = `${start} && chmod 700 "$T" && touch "$T/file" && rm -rf "$T"`;
  expect(fits(command)).toBe(true);
  const result = spawnSync(
    "bash",
    [
      "--noprofile",
      "--norc",
      "-c",
      `
    mktemp() { if [ ${status} -eq 0 ]; then printf '%s\\n' '${parent}/created'; fi; return ${status}; }
    chmod() { printf 'chmod:%s\\n' "$@"; }
    touch() { printf 'touch:%s\\n' "$@"; }
    rm() { printf 'rm:%s\\n' "$@"; }
    ${command}
  `,
    ],
    { encoding: "utf8", env: { PATH: process.env.PATH, BASH_ENV: "" } },
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(status);
  expect(result.stderr).toBe("");
  expect(result.stdout).toBe(
    status === 0
      ? `chmod:700\nchmod:${parent}/created\ntouch:${parent}/created/file\nrm:-rf\nrm:${parent}/created\n`
      : "",
  );
});
