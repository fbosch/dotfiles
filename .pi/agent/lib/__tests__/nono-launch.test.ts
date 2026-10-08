import { afterEach, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchArguments, launchCommand } from "../nono-launch";

const created: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-nono-"));
  created.push(root);
  const home = join(root, "home");
  const cwd = join(root, "project");
  const agent = join(home, ".pi", "agent");
  mkdirSync(agent, { recursive: true });
  mkdirSync(cwd);
  return { root, home, cwd, agent };
}
afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

function grants(args: string[]): string[] {
  return args.flatMap((arg, i) => (arg === "--allow" ? [args[i + 1] ?? ""] : []));
}

test("grants canonical global references and Stow target without granting HOME", () => {
  const { root, home, cwd, agent } = fixture();
  const target = join(root, "target");
  mkdirSync(target);
  symlinkSync(target, join(home, "nixos"));
  writeFileSync(
    join(agent, "settings.json"),
    JSON.stringify({
      references: {
        nixos: { path: "~/nixos", description: "NixOS" },
        absent: { path: "~/absent", description: "Missing" },
      },
    }),
  );
  const allowed = grants(launchArguments(cwd, agent, home, {}));
  expect(allowed).toContain(realpathSync(target));
  expect(allowed).not.toContain(home);
  expect(allowed).not.toContain(join(home, "absent"));
});

test("does not read or grant untrusted project references, then grants after saved trust", () => {
  const { root, home, cwd, agent } = fixture();
  const outside = join(root, "outside");
  mkdirSync(outside);
  mkdirSync(join(cwd, ".pi"));
  writeFileSync(
    join(cwd, ".pi", "settings.json"),
    JSON.stringify({
      references: {
        secret: { path: outside, description: "outside" },
      },
    }),
  );
  expect(grants(launchArguments(cwd, agent, home, {}))).not.toContain(realpathSync(outside));
  writeFileSync(join(agent, "trust.json"), JSON.stringify({ [realpathSync(cwd)]: true }));
  expect(grants(launchArguments(cwd, agent, home, {}))).toContain(realpathSync(outside));
});

test("invalid trusted references fail before nono starts", () => {
  const { home, cwd, agent } = fixture();
  writeFileSync(
    join(agent, "settings.json"),
    JSON.stringify({ references: { bad: { path: "~/oops" } } }),
  );
  expect(() => launchArguments(cwd, agent, home, {})).toThrow("requires a description");
});

test("launches with writable cwd, suppressed save suggestions, and visible denial diagnostics", () => {
  const { cwd, agent, home } = fixture();
  const args = launchArguments(cwd, agent, home, {});
  expect(args).toContain("--allow-cwd");
  expect(
    args.slice(args.indexOf("--suppress-save-prompt"), args.indexOf("--suppress-save-prompt") + 2),
  ).toEqual(["--suppress-save-prompt", "/"]);
  expect(args).not.toContain("--no-diagnostics");
  expect(args.slice(-2)).toEqual(["--", "/run/current-system/sw/bin/pi"]);
});

test("grants extension state and exact config aliases without opening their parents", () => {
  const { root, cwd, agent, home } = fixture();
  const config = join(home, ".config");
  const data = join(home, ".local", "share");
  const lens = join(home, ".pi-lens");
  const hashline = join(config, "pi-hashline-edit-pro");
  const queries = join(data, "nvim", "fff_queries");
  for (const path of [
    lens,
    hashline,
    queries,
    join(config, "fbb", "data"),
    join(config, "nix", "git"),
  ]) {
    mkdirSync(path, { recursive: true });
  }
  const target = join(root, "typos.abolish");
  writeFileSync(target, "teh the\n");
  const typoAlias = join(config, "fbb", "data", "typos.abolish");
  symlinkSync(target, typoAlias);
  const gitConfig = join(config, "nix", "git", "config");
  writeFileSync(gitConfig, "[core]\n");
  const args = launchArguments(cwd, agent, home, {});
  expect(grants(args)).toEqual(expect.arrayContaining([lens, hashline]));
  expect(grants(args)).toContain(queries);
  for (const path of [typoAlias, gitConfig]) {
    expect(args.slice(args.indexOf(path) - 1, args.indexOf(path) + 1)).toEqual([
      "--read-file",
      path,
    ]);
  }
  for (const parent of [home, config, data, join(home, "..")]) {
    expect(args).not.toContain(parent);
  }
});

test("honors XDG and hashline overrides while omitting missing integration paths", () => {
  const { root, cwd, agent, home } = fixture();
  const config = join(root, "config");
  const data = join(root, "data");
  const hashline = join(root, "hashline");
  const queries = join(data, "nvim", "fff_queries");
  const cache = join(root, "cache");
  const frecency = join(cache, "nvim", "fff_nvim");
  mkdirSync(frecency, { recursive: true });
  mkdirSync(hashline);
  mkdirSync(queries, { recursive: true });
  const args = launchArguments(cwd, agent, home, {
    XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: data,
    XDG_CACHE_HOME: cache,
    PI_HASHLINE_DIR: hashline,
  });
  expect(grants(args)).toContain(hashline);
  expect(grants(args)).toContain(frecency);
  expect(args).not.toContain(cache);
  expect(args).not.toContain(join(cache, "nvim"));
  expect(args.slice(args.indexOf(queries) - 1, args.indexOf(queries) + 1)).toEqual([
    "--allow",
    queries,
  ]);
  expect(args).not.toContain(join(home, ".pi-lens"));
  expect(args).not.toContain(join(config, "fbb", "data", "typos.abolish"));
  expect(args).not.toContain(join(home, ".config", "pi-hashline-edit-pro"));
});

test("local profile keeps default protection and platform-specific runtime groups", () => {
  const profile = JSON.parse(
    readFileSync(join(import.meta.dir, "..", "nono", "pi.json"), "utf8"),
  ) as {
    extends: string;
    groups: { include: unknown[] };
    security: { signal_mode: string; capability_elevation: boolean };
    unsafe_macos_seatbelt_rules: string[];
    filesystem: { suppress_save_prompt: string[]; allow: string[] };
    workdir: { access: string };
    network: { block: boolean };
  };
  expect(profile.extends).toBe("default");
  expect(profile.groups.include).toContainEqual({ name: "user_caches_macos", when: "macos" });
  expect(profile.groups.include).toContainEqual({ name: "user_caches_linux", when: "linux" });
  expect(profile.groups.include).toContainEqual({ name: "linux_sysfs_read", when: "linux" });
  expect(profile.groups.include).not.toContain("user_caches_macos");
  expect(profile.security).toEqual({ signal_mode: "isolated", capability_elevation: false });
  expect(profile.unsafe_macos_seatbelt_rules).toEqual(["(allow ipc-sysv-sem)"]);
  expect(profile.filesystem.allow).toEqual(["$HOME/.pi"]);
  expect(profile.filesystem.suppress_save_prompt).toEqual(["/"]);
  expect(profile.workdir.access).toBe("readwrite");
  expect(profile.network.block).toBe(false);
});

test("--no-sandbox bypasses policy loading and passes remaining arguments directly to Pi", () => {
  const { cwd, agent, home } = fixture();
  writeFileSync(join(agent, "settings.json"), "invalid JSON");
  const args = ["--print", "a prompt with spaces", "--", "--no-sandbox"];
  expect(launchCommand(["--no-sandbox", ...args], cwd, agent, home, false)).toEqual([
    "/run/current-system/sw/bin/pi",
    ...args,
  ]);
  expect(launchCommand(["--no-sandbox", ...args], cwd, agent, home, true)).toEqual([
    "/run/current-system/sw/bin/pi",
    ...args,
  ]);
});

test("--no-sandbox is not consumed from a Pi option value or after the argument separator", () => {
  const { cwd, agent, home } = fixture();
  for (const args of [
    ["--append-system-prompt", "--no-sandbox"],
    ["--", "--no-sandbox"],
  ]) {
    const command = launchCommand(args, cwd, agent, home, false);
    expect(command[0]).toBe("/run/current-system/sw/bin/nono");
    expect(command.slice(-args.length)).toEqual(args);
  }
});

test("a nested Pi preserves argv and does not resolve references or start another nono", () => {
  const { cwd, agent, home } = fixture();
  writeFileSync(join(agent, "settings.json"), "invalid JSON");
  const args = ["--print", "--", "a prompt with spaces", "--json"];
  expect(launchCommand(args, cwd, agent, home, true)).toEqual([
    "/run/current-system/sw/bin/pi",
    ...args,
  ]);
  expect(() => launchCommand(args, cwd, agent, home, false)).toThrow(
    "Cannot load project references",
  );
});
