import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface PackagePatch {
  name: string;
  version: string;
  patchFilenames: string[];
}

interface ParsedPatchFilename {
  name: string;
  version: string;
}

const VERSION_PREFIX = /^\d+\.\d+\.\d+.*$/;
const PACKAGE_PART = /^[a-z0-9][a-z0-9._~-]*$/;
const PACKAGE_SCOPE = /^@[a-z0-9][a-z0-9._~-]*$/;
const SEQUENCE_NUMBER = /^\d+$/;

function invalidPatchFilename(filename: string, reason: string): never {
  throw new Error(
    `Invalid patch filename ${filename}: ${reason}. Use package+version.patch or @scope+package+version.patch.`,
  );
}

function parsePatchFilename(filename: string): ParsedPatchFilename {
  const stem = filename.replace(/(?:\.dev)?\.patch$/, "");
  if (stem === filename) invalidPatchFilename(filename, "expected a .patch or .dev.patch suffix");
  if (stem.includes("++")) {
    invalidPatchFilename(filename, "nested-package patches are not supported by this runner");
  }

  const parts = stem.split("+");
  const versionIndex = parts.findIndex((part) => VERSION_PREFIX.test(part));
  if (versionIndex === -1) invalidPatchFilename(filename, "missing a semantic version");

  const nameParts = parts.slice(0, versionIndex);
  const sequenceParts = parts.slice(versionIndex + 1);
  const isUnscoped = nameParts.length === 1 && PACKAGE_PART.test(nameParts[0] ?? "");
  const isScoped =
    nameParts.length === 2 &&
    (nameParts[0] ?? "").startsWith("@") &&
    PACKAGE_SCOPE.test(nameParts[0] ?? "") &&
    PACKAGE_PART.test(nameParts[1] ?? "");
  if (!isUnscoped && !isScoped) invalidPatchFilename(filename, "invalid package name");

  if (
    sequenceParts.length > 2 ||
    (sequenceParts.length > 0 && !SEQUENCE_NUMBER.test(sequenceParts[0] ?? "")) ||
    (sequenceParts.length === 2 && sequenceParts[1] === "")
  ) {
    invalidPatchFilename(filename, "invalid patch-package sequence suffix");
  }

  const name = isScoped ? nameParts.join("/") : nameParts[0];
  const version = parts[versionIndex];
  if (!name || !version) invalidPatchFilename(filename, "missing package identity");
  return { name, version };
}

function validatePatchContent(directory: string, filename: string): void {
  const contents = readFileSync(resolve(directory, filename), "utf8");
  // patch-package accepts an empty effects list as a successful application.
  if (
    !/^diff --git /m.test(contents) ||
    !/^@@ /m.test(contents) ||
    !/^[+-](?![+-])/m.test(contents)
  ) {
    throw new Error(
      `${filename} contains no textual changes. Regenerate the patch before applying it.`,
    );
  }
}

export function discoverPackagePatches(directory: string): PackagePatch[] {
  const patches = new Map<string, PackagePatch>();
  const filenames = readdirSync(directory)
    .filter((filename) => filename.endsWith(".patch"))
    .sort();

  for (const patchFilename of filenames) {
    const { name, version } = parsePatchFilename(patchFilename);
    validatePatchContent(directory, patchFilename);

    const existing = patches.get(name);
    if (existing && existing.version !== version) {
      throw new Error(
        `Patch directory contains multiple versions of ${name}: ${existing.version} and ${version}. Keep one reviewed version.`,
      );
    }
    if (existing) {
      existing.patchFilenames.push(patchFilename);
    } else {
      patches.set(name, { name, version, patchFilenames: [patchFilename] });
    }
  }

  return [...patches.values()].sort((left, right) => left.name.localeCompare(right.name));
}
