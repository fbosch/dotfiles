import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface PatchTarget {
  path: string;
  before: string | null;
  after: string | null;
}

type PatchTargets = Map<string, PatchTarget[]>;

const HASH = /^[a-f0-9]{64}$/;

function manifestKey(packageName: string, patchFilename: string): string {
  return `${packageName}\0${patchFilename}`;
}

function validRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function parseHash(value: string, filename: string): string | null {
  if (value === "-") return null;
  if (!HASH.test(value)) throw new Error(`${filename} contains an invalid SHA-256 value: ${value}`);
  return value;
}

export function readPackagePatchTargets(manifestPath: string): PatchTargets {
  const entries: PatchTargets = new Map();
  const lines = readFileSync(manifestPath, "utf8").split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    if (line.trim() === "" || line.startsWith("#")) continue;
    const [kind, packageName, patchFilename, targetPath, beforeText, afterText, extra] =
      line.split("\t");
    if (
      (kind !== "package" && kind !== "runtime") ||
      !packageName ||
      !patchFilename ||
      !targetPath ||
      beforeText === undefined ||
      afterText === undefined ||
      extra !== undefined
    ) {
      throw new Error(`${manifestPath}:${index + 1}: expected six tab-separated fields`);
    }
    if (!validRelativePath(targetPath)) {
      throw new Error(`${manifestPath}:${index + 1}: target path must be package-relative`);
    }
    const before = parseHash(beforeText, manifestPath);
    const after = parseHash(afterText, manifestPath);
    if (before === after) {
      throw new Error(`${manifestPath}:${index + 1}: preimage and postimage must differ`);
    }
    if (kind === "runtime") continue;

    const key = manifestKey(packageName, patchFilename);
    const targets = entries.get(key) ?? [];
    if (targets.some((target) => target.path === targetPath)) {
      throw new Error(`${manifestPath}:${index + 1}: duplicate target ${targetPath}`);
    }
    targets.push({ path: targetPath, before, after });
    entries.set(key, targets);
  }
  return entries;
}

function packageRelativeTargetPath(
  headerPath: string,
  packageName: string,
  patchFilename: string,
): string {
  const prefix = `node_modules/${packageName}/`;
  if (!headerPath.startsWith(prefix)) {
    throw new Error(`${patchFilename} has a target outside ${packageName}: ${headerPath}`);
  }
  const targetPath = headerPath.slice(prefix.length);
  if (!validRelativePath(targetPath)) {
    throw new Error(`${patchFilename} contains an unsafe target path: ${headerPath}`);
  }
  return targetPath;
}

export function readPatchTargetPaths(
  patchPath: string,
  packageName: string,
  patchFilename: string,
): string[] {
  const contents = readFileSync(patchPath, "utf8");
  const sections = contents.split(/^diff --git /m).slice(1);
  const paths = sections.map((section) => {
    const oldPath = section.match(/^--- (.+)$/m)?.[1]?.split("\t", 1)[0];
    const newPath = section.match(/^\+\+\+ (.+)$/m)?.[1]?.split("\t", 1)[0];
    if (oldPath === undefined || newPath === undefined) {
      throw new Error(`${patchFilename} contains a diff without file headers`);
    }
    const oldTarget = oldPath === "/dev/null" ? undefined : oldPath.replace(/^a\//, "");
    const newTarget = newPath === "/dev/null" ? undefined : newPath.replace(/^b\//, "");
    const target = newTarget ?? oldTarget;
    if (target === undefined) throw new Error(`${patchFilename} contains an empty file diff`);
    return packageRelativeTargetPath(target, packageName, patchFilename);
  });

  if (paths.length === 0 || new Set(paths).size !== paths.length) {
    throw new Error(`${patchFilename} has missing or duplicate file targets`);
  }
  return paths.sort();
}

function hashExistingFile(packageDirectory: string, targetPath: string): string | null {
  let current = packageDirectory;
  const parts = targetPath.split("/");
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    let stat: Stats;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to hash a symlinked patch target: ${current}`);
    }
    if (index < parts.length - 1) {
      if (!stat.isDirectory())
        throw new Error(`Patch target parent is not a directory: ${current}`);
    } else {
      if (!stat.isFile()) throw new Error(`Patch target is not a regular file: ${current}`);
      return createHash("sha256").update(readFileSync(current)).digest("hex");
    }
  }
  return null;
}

export function assertPostimageTargets(packageDirectory: string, targets: PatchTarget[]): void {
  const packageRoot = resolve(packageDirectory);
  for (const target of targets) {
    const actual = hashExistingFile(packageRoot, target.path);
    if (actual !== target.after) {
      throw new Error(
        `Patch did not produce the reviewed postimage for ${packageRoot}/${target.path}`,
      );
    }
  }
}

export function planPackagePatchTargets(
  packageDirectory: string,
  packageName: string,
  patchDirectory: string,
  patchFilenames: string[],
  manifest: PatchTargets,
): { targets: PatchTarget[]; alreadyApplied: boolean } {
  const packageRoot = resolve(packageDirectory);
  const plans = new Map<string, PatchTarget>();

  for (const patchFilename of patchFilenames) {
    const key = manifestKey(packageName, patchFilename);
    const targetEntries = manifest.get(key);
    if (!targetEntries || targetEntries.length === 0) {
      throw new Error(`${patchFilename} has no reviewed target hashes in patches/targets.tsv`);
    }
    const actualPaths = readPatchTargetPaths(
      resolve(patchDirectory, patchFilename),
      packageName,
      patchFilename,
    );
    const manifestPaths = targetEntries.map((target) => target.path).sort();
    if (actualPaths.join("\0") !== manifestPaths.join("\0")) {
      throw new Error(`${patchFilename} targets do not match patches/targets.tsv`);
    }

    for (const target of targetEntries) {
      const previous = plans.get(target.path);
      if (previous) {
        if (previous.after !== target.before) {
          throw new Error(`Inconsistent reviewed patch sequence for ${packageName}/${target.path}`);
        }
        previous.after = target.after;
      } else {
        plans.set(target.path, { ...target });
      }
    }
  }

  const targets = [...plans.values()].sort((left, right) => left.path.localeCompare(right.path));
  const states = targets.map((target) => {
    const current = hashExistingFile(packageRoot, target.path);
    if (current === target.before) return "before";
    if (current === target.after) return "after";
    return "unknown";
  });
  const allBefore = states.every((state) => state === "before");
  const allAfter = states.every((state) => state === "after");
  if (!allBefore && !allAfter) {
    const invalidIndex = states.indexOf("unknown");
    const invalid = targets[invalidIndex];
    const partial = states.includes("before") && states.includes("after");
    throw new Error(
      partial
        ? `Refusing partially applied patch set for ${packageName}; target files have mixed reviewed contents.`
        : `Refusing to patch ${packageName}/${invalid?.path ?? "targets"}: content does not match a reviewed preimage or postimage.`,
    );
  }

  return { targets, alreadyApplied: allAfter };
}

export function assertPatchManifestInventory(
  manifest: PatchTargets,
  packages: Array<{ name: string; patchFilenames: string[] }>,
): void {
  const knownKeys = new Set(
    packages.flatMap((pkg) =>
      pkg.patchFilenames.map((filename) => manifestKey(pkg.name, filename)),
    ),
  );
  for (const key of manifest.keys()) {
    if (!knownKeys.has(key)) {
      const [packageName, patchFilename] = key.split("\0");
      throw new Error(`patches/targets.tsv has stale entry for ${packageName}/${patchFilename}`);
    }
  }
}
