import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const SDK_NAME = "@earendil-works/pi-coding-agent";

export interface RuntimeSdk {
  directory: string;
  version: string;
}

export function findRuntimeExecutable(path = process.env.PATH ?? ""): string | null {
  // bun run prepends node_modules/.bin, which contains the stale development CLI.
  const runtimePath = path
    .split(":")
    .filter((entry) => !entry.endsWith("/node_modules/.bin"))
    .join(":");
  return Bun.which("pi", { PATH: runtimePath });
}

export function inspectRuntimeSdk(directory: string): RuntimeSdk {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  } catch (cause) {
    throw new Error(`Cannot read Pi SDK manifest in ${directory}`, { cause });
  }
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("name" in manifest) ||
    manifest.name !== SDK_NAME ||
    !("version" in manifest) ||
    typeof manifest.version !== "string" ||
    !existsSync(join(directory, "dist/index.d.ts")) ||
    !existsSync(join(directory, "dist/index.js"))
  )
    throw new Error(`Not an installed Pi SDK: ${directory}`);
  return { directory: realpathSync(directory), version: manifest.version };
}

function nixReferences(root: string): string[] {
  return execFileSync("nix-store", ["--query", "--references", root], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
}

export function resolveRuntimeSdk(
  executable: string,
  references: (root: string) => string[] = nixReferences,
): RuntimeSdk {
  const binary = realpathSync(executable);
  const candidates = new Set<string>();
  let ancestor = dirname(binary);
  for (let depth = 0; depth < 5; depth += 1) {
    candidates.add(ancestor);
    candidates.add(join(ancestor, "lib/pi/node_modules", SDK_NAME));
    ancestor = dirname(ancestor);
  }
  // The Nix sandbox launcher is a binary wrapper, not the SDK package itself.
  const storeRoot = binary.match(/^\/nix\/store\/[^/]+/)?.[0];
  if (storeRoot) {
    for (const reference of references(storeRoot)) {
      candidates.add(join(reference, "lib/pi/node_modules", SDK_NAME));
    }
  }
  const matches = [...candidates]
    .filter((directory) => existsSync(join(directory, "dist/index.d.ts")))
    .map(inspectRuntimeSdk);
  const unique = new Map(matches.map((sdk) => [sdk.directory, sdk]));
  if (unique.size !== 1) {
    throw new Error(
      `Expected one Pi SDK for ${binary}; found ${unique.size}. Pass --sdk-root with the intended installed SDK directory.`,
    );
  }
  const sdk = unique.values().next().value;
  if (!sdk) throw new Error("Pi SDK resolution returned no package");
  return sdk;
}

export function runtimeSdkConfig(sdk: RuntimeSdk) {
  const scope = dirname(sdk.directory);
  const paths: Record<string, string[]> = {};
  const entries = readdirSync(scope, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const directory = join(scope, entry.name);
    if (!existsSync(join(directory, "package.json"))) continue;
    paths[`@earendil-works/${entry.name}`] = [directory];
    paths[`@earendil-works/${entry.name}/*`] = [join(directory, "*")];
  }
  return { compilerOptions: { paths } };
}

export function syncRuntimeSdk(agentRoot: string, sdk: RuntimeSdk, check = false): void {
  const target = join(agentRoot, "node_modules/.cache/pi-sdk/tsconfig.json");
  const content = `${JSON.stringify(runtimeSdkConfig(sdk), null, 2)}\n`;
  if (check) {
    if (!existsSync(target) || readFileSync(target, "utf8") !== content) {
      throw new Error(
        "Pi SDK declarations are stale. Run bun run sdk:sync before checking extensions.",
      );
    }
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    let check = false;
    let sdkRoot: string | undefined;
    while (args.length > 0) {
      const argument = args.shift();
      if (argument === "--check") check = true;
      else if (argument === "--sdk-root" && args[0] && !args[0].startsWith("--")) {
        sdkRoot = args.shift();
      } else {
        throw new Error(
          "Usage: runtime-sdk.ts [--check] [--sdk-root <installed-package-directory>]",
        );
      }
    }
    const executable = findRuntimeExecutable();
    if (!sdkRoot && !executable) throw new Error("pi is not on PATH");
    const sdk = sdkRoot ? inspectRuntimeSdk(resolve(sdkRoot)) : resolveRuntimeSdk(executable ?? "");
    syncRuntimeSdk(resolve(import.meta.dir, ".."), sdk, check);
    console.log(`Pi SDK ${sdk.version}: ${sdk.directory}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
