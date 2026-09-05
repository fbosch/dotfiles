import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const agentRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const patchDirectory = resolve(agentRoot, "patches");
const patchPackage = resolve(agentRoot, "node_modules/patch-package/index.js");

interface PatchedPackage {
  name: string;
  version: string;
  patchFilename: string;
}

const patchedPackages = [
  {
    name: "@gotgenes/pi-permission-system",
    version: "31.1.1",
    patchFilename: "@gotgenes+pi-permission-system+31.1.1.patch",
  },
  {
    name: "pi-worktrunk",
    version: "0.8.0",
    patchFilename: "pi-worktrunk+0.8.0.patch",
  },
] as const satisfies readonly PatchedPackage[];

function readObject(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected a JSON object in ${path}`);
  }
  return value as Record<string, unknown>;
}

function hasDependency(root: string, packageName: string): boolean {
  const manifest = resolve(root, "package.json");
  if (!existsSync(manifest)) return false;
  const dependencies = readObject(manifest).dependencies;
  return !!dependencies && typeof dependencies === "object" && packageName in dependencies;
}

function validatePatchFiles(): void {
  const actual = readdirSync(patchDirectory)
    .filter((name) => name.endsWith(".patch"))
    .sort();
  const expected = patchedPackages.map(({ patchFilename }) => patchFilename).sort();
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw new Error(
      `Expected only ${expected.join(", ")} in ${patchDirectory}. Review the patch runner before changing patches.`,
    );
  }

  for (const { patchFilename } of patchedPackages) {
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
  }
}

export function applyPiPatches(root: string, required = true): number {
  root = realpathSync(root);
  validatePatchFiles();

  const installedPackages: PatchedPackage[] = [];
  for (const patchedPackage of patchedPackages) {
    const manifest = resolve(root, "node_modules", patchedPackage.name, "package.json");
    if (!existsSync(manifest)) {
      if (!required && !hasDependency(root, patchedPackage.name)) continue;
      throw new Error(
        `${patchedPackage.name}@${patchedPackage.version} is missing from ${root}. Install it with Pi first.`,
      );
    }

    // patch-package only warns about version mismatches, after modifying files.
    const installed = readObject(manifest);
    if (installed.name !== patchedPackage.name || installed.version !== patchedPackage.version) {
      throw new Error(
        `Refusing to patch ${patchedPackage.name}@${String(installed.version)}. This patch requires exactly ${patchedPackage.version}; review and regenerate it before upgrading.`,
      );
    }
    installedPackages.push(patchedPackage);
  }

  if (installedPackages.length === 0) return 0;
  if (!existsSync(patchPackage)) {
    throw new Error("patch-package is missing. Run just install-pi before installing Pi packages.");
  }

  const workspace = mkdtempSync(join(tmpdir(), "pi-package-patches-"));
  const selectedPatchDirectory = join(workspace, "patches");
  const preflightRoot = join(workspace, "preflight");
  try {
    mkdirSync(selectedPatchDirectory);
    mkdirSync(join(preflightRoot, "node_modules"), { recursive: true });
    writeFileSync(join(preflightRoot, "package.json"), '{"private":true}\n');
    for (const patchedPackage of installedPackages) {
      copyFileSync(
        resolve(patchDirectory, patchedPackage.patchFilename),
        resolve(selectedPatchDirectory, patchedPackage.patchFilename),
      );
      const packageCopy = resolve(preflightRoot, "node_modules", patchedPackage.name);
      mkdirSync(dirname(packageCopy), { recursive: true });
      cpSync(resolve(root, "node_modules", patchedPackage.name), packageCopy, {
        recursive: true,
      });
    }

    const invokePatchPackage = (cwd: string) =>
      Bun.spawnSync(
        [
          process.execPath,
          patchPackage,
          "--patch-dir",
          relative(cwd, selectedPatchDirectory),
          "--error-on-fail",
          "--error-on-warn",
        ],
        { cwd, stdin: "inherit", stdout: "inherit", stderr: "inherit" },
      );
    const preflight = invokePatchPackage(preflightRoot);
    if (preflight.exitCode !== 0) return preflight.exitCode;
    return invokePatchPackage(root).exitCode;
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
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
    for (const { name, version } of patchedPackages) {
      for (const arg of args) {
        if ((arg === name || arg.startsWith(`${name}@`)) && arg !== `${name}@${version}`) {
          throw new Error(
            `Install exactly ${name}@${version}, or review and regenerate its patch first.`,
          );
        }
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
