import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isMatching, match, P } from "ts-pattern";
import { compactDiscoveryDescription, type DiscoveryMatch } from "../../lib/discovery-ranking";
import { type JustRecipe, parseJustCatalog, searchRecipes } from "../just/catalog";

export interface Script {
  id: string;
  source: "just" | "package";
  name: string;
  description: string;
  command: string[];
  fingerprint: string;
  recipe?: JustRecipe;
}

function parseJson<T>(text: string, source: string, decode: (value: unknown) => T): T {
  try {
    return decode(JSON.parse(text));
  } catch (error) {
    throw new Error(`Invalid JSON from ${source}`, { cause: error });
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await realpath(path);
    return true;
  } catch (error) {
    if (isMatching({ code: "ENOENT" }, error)) return false;
    throw error;
  }
}

async function packageManager(cwd: string, declared: string | undefined): Promise<string> {
  if (declared !== undefined) {
    const manager = declared.split("@")[0];
    if (manager !== undefined && ["npm", "pnpm", "yarn", "bun"].includes(manager)) return manager;
    throw new Error(`Unsupported package manager: ${declared}`);
  }
  const managers = new Set<string>();
  for (const [file, manager] of [
    ["package-lock.json", "npm"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
  ] as const) {
    if (await exists(join(cwd, file))) managers.add(manager);
  }
  if (managers.size > 1)
    throw new Error("Conflicting package-manager lockfiles; set packageManager in package.json");
  return [...managers][0] ?? "npm";
}

export async function discoverScripts(
  pi: Pick<ExtensionAPI, "exec">,
  cwd: string,
  signal?: AbortSignal,
): Promise<Script[]> {
  const scripts: Script[] = [];
  for (const filename of ["justfile", "Justfile", ".justfile"]) {
    const path = join(cwd, filename);
    if (!(await exists(path))) continue;
    const result = await pi.exec("just", ["--no-dotenv", "--justfile", path, "--json"], {
      cwd,
      timeout: 10_000,
      ...(signal === undefined ? {} : { signal }),
    });
    if (result.killed || result.code !== 0)
      throw new Error(`Could not inspect Just recipes: ${result.stderr}`);
    const recipes = parseJson(result.stdout, "just --json", (value) =>
      parseJustCatalog(value, { firstLineDocumentation: true }),
    );
    for (const recipe of recipes) {
      scripts.push({
        id: `just:${recipe.namepath}`,
        source: "just",
        name: recipe.namepath,
        description: recipe.doc,
        fingerprint: createHash("sha256").update(result.stdout).digest("hex"),
        command: ["just", "--justfile", path, "--yes", "--one", "--", recipe.namepath],
        recipe,
      });
    }
    break;
  }
  const packagePath = join(cwd, "package.json");
  if (await exists(packagePath)) {
    const pattern = {
      scripts: P.optional(P.record(P.string, P.string)),
      packageManager: P.optional(P.string),
    };
    const value = parseJson(await readFile(packagePath, "utf8"), "package.json", (data) => {
      if (!isMatching(pattern, data)) throw new Error("Invalid package.json script metadata");
      return data;
    });
    const manager = await packageManager(cwd, value.packageManager);
    for (const [name, description] of Object.entries(value.scripts ?? {})) {
      // Script names cannot be interpreted as package-manager options.
      if (name.startsWith("-") || name.includes("\0")) continue;
      scripts.push({
        id: `package:${name}`,
        source: "package",
        name,
        description,
        command: [manager, "run", name],
        fingerprint: createHash("sha256").update(JSON.stringify(value)).digest("hex"),
      });
    }
  }
  return scripts;
}

export function scriptSearchDescription(script: Script): string {
  return compactDiscoveryDescription(
    script.source === "package" ? `Package script: ${script.name}` : script.description,
  );
}

export function rankScriptsLocally(scripts: readonly Script[], query: string): DiscoveryMatch[] {
  if (query.trim().length === 0) return scripts.map((script) => ({ name: script.id, score: 0 }));
  const entries = scripts.map((script) => ({
    script,
    recipe: {
      name: script.name,
      namepath: script.name,
      doc: scriptSearchDescription(script),
      groups: script.recipe?.groups ?? [],
      aliases: [script.id, ...(script.recipe?.aliases ?? [])],
      parameters: script.recipe?.parameters ?? [],
    },
  }));
  const byRecipe = new Map(entries.map((entry) => [entry.recipe, entry.script]));
  const normalized = query.trim().toLowerCase();
  const matches = searchRecipes(
    entries.map((entry) => entry.recipe),
    query,
    entries.length,
    // Keep /just's tokenizer unchanged while matching Unicode script names and tags.
    /[^\p{L}\p{N}\p{M}]+/u,
  ).map((recipe) => {
    const script = byRecipe.get(recipe);
    if (script === undefined) throw new Error("Ranked script is outside the catalog");
    return script;
  });
  // Preserve Just's ordering except when the query names an exact cross-source script ID.
  matches.sort(
    (left, right) =>
      Number(right.id.toLowerCase() === normalized) - Number(left.id.toLowerCase() === normalized),
  );
  return matches.map((script, index) => ({ name: script.id, score: matches.length - index }));
}

export function scriptCommand(script: Script, args: string[]): string[] {
  return match(script.source)
    .with("just", () => [...script.command, ...args])
    .with("package", () => [
      ...script.command,
      ...(script.command[0] === "npm" && args.length > 0 ? ["--"] : []),
      ...args,
    ])
    .exhaustive();
}

export function taskPath(script: Script, command: string[]): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([script.id, command]))
    .digest("hex")
    .slice(0, 24);
  return `pi/${script.source}/${digest}`;
}

export function isManagedTask(path: string): boolean {
  return /^pi\/(just|package)\/[a-f0-9]{24}$/u.test(path);
}
