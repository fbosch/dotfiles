import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const agentRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const patchDirectory = resolve(agentRoot, "patches");
const patchPackage = resolve(agentRoot, "node_modules/patch-package/index.js");
const packageName = "pi-worktrunk";
const packageVersion = "0.8.0";
const patchFilename = `${packageName}+${packageVersion}.patch`;

function readObject(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected a JSON object in ${path}`);
  }
  return value as Record<string, unknown>;
}

function hasDependency(root: string): boolean {
  const manifest = resolve(root, "package.json");
  if (!existsSync(manifest)) return false;
  const dependencies = readObject(manifest).dependencies;
  return !!dependencies && typeof dependencies === "object" && packageName in dependencies;
}

export function applyPiPatches(root: string, required = true): number {
  root = realpathSync(root);
  const manifest = resolve(root, "node_modules", packageName, "package.json");
  if (!existsSync(manifest)) {
    if (!required && !hasDependency(root)) return 0;
    throw new Error(
      `${packageName}@${packageVersion} is missing from ${root}. Install it with Pi first.`,
    );
  }
  // patch-package only warns about version mismatches, after modifying files.
  const installed = readObject(manifest);
  if (installed.name !== packageName || installed.version !== packageVersion) {
    throw new Error(
      `Refusing to patch ${packageName}@${String(installed.version)}. This patch requires exactly ${packageVersion}; review and regenerate it before upgrading.`,
    );
  }
  const patches = readdirSync(patchDirectory).filter((name) => name.endsWith(".patch"));
  if (patches.length !== 1 || patches[0] !== patchFilename) {
    throw new Error(
      `Expected only ${patchFilename} in ${patchDirectory}. Review the patch runner before adding patches.`,
    );
  }
  const contents = readFileSync(resolve(patchDirectory, patchFilename), "utf8");
  // patch-package accepts an empty effects list as a successful application.
  if (
    !/^diff --git /m.test(contents) ||
    !/^@@ /m.test(contents) ||
    !/^[+-](?![+-])/m.test(contents)
  ) {
    throw new Error(
      `${patchFilename} contains no textual changes. Regenerate the patch before applying it.`,
    );
  }
  if (!existsSync(patchPackage)) {
    throw new Error("patch-package is missing. Run just install-pi before installing Pi packages.");
  }
  const result = Bun.spawnSync(
    [
      process.execPath,
      patchPackage,
      "--patch-dir",
      relative(root, patchDirectory),
      "--error-on-fail",
      "--error-on-warn",
    ],
    { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" },
  );
  return result.exitCode;
}

export function runPiNpm(args: string[], cwd = process.cwd()): number {
  if (args[0] === "--apply-patches") {
    if (args.length > 2) throw new Error("Usage: pi-npm --apply-patches [install-root]");
    return applyPiPatches(resolve(cwd, args[1] ?? resolve(agentRoot, "npm")));
  }

  const mutates = ["install", "ci", "update", "uninstall"].includes(args[0] ?? "");
  const global = args.includes("--global") || args.includes("-g");
  const dryRun = args.includes("--dry-run") || args.includes("--dry-run=true");
  if (mutates && !global && args[0] !== "uninstall") {
    for (const arg of args) {
      if (
        (arg === packageName || arg.startsWith(`${packageName}@`)) &&
        arg !== `${packageName}@${packageVersion}`
      ) {
        throw new Error(
          `Install exactly ${packageName}@${packageVersion}, or review and regenerate its patch first.`,
        );
      }
    }
  }
  const prefixIndex = args.indexOf("--prefix");
  if (prefixIndex !== -1 && !args[prefixIndex + 1]) throw new Error("--prefix requires a path");
  const prefix = args.find((arg) => arg.startsWith("--prefix="))?.slice("--prefix=".length);
  const root = resolve(cwd, prefix ?? (prefixIndex === -1 ? cwd : (args[prefixIndex + 1] ?? cwd)));
  const result = Bun.spawnSync(["npm", "--save-exact", ...args], {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0 || !mutates || global || dryRun) return result.exitCode;
  return applyPiPatches(root, false);
}

if (import.meta.main) {
  try {
    process.exitCode = runPiNpm(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
