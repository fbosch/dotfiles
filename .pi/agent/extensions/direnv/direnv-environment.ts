import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export type DirenvEnvironment = Record<string, string | null>;

export type DirenvLoadResult =
  | { status: "missing" | "unavailable" }
  | { status: "blocked" }
  | { status: "loaded"; environment: DirenvEnvironment };

type ExportDirenv = (directory: string) => Promise<string>;

function isWithin(directory: string, boundary: string): boolean {
  const path = relative(boundary, directory);
  return path === "" || (path.startsWith("..") === false && isAbsolute(path) === false);
}

export function findProjectDirectory(directory: string): string {
  const start = resolve(directory);
  let current = start;

  while (true) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}

function findEnvrcDirectory(directory: string, projectDirectory: string): string | undefined {
  const start = resolve(directory);
  const project = resolve(projectDirectory);
  const boundary = isWithin(start, project) ? project : start;
  let current = start;

  while (true) {
    if (existsSync(join(current, ".envrc"))) return current;
    if (current === boundary) return undefined;
    current = dirname(current);
  }
}

function isBlocked(error: unknown): boolean {
  if (typeof error !== "object" || error === null || "stderr" in error === false) return false;
  const { stderr } = error as { stderr?: unknown };
  return typeof stderr === "string" && stderr.includes("is blocked");
}

function parseEnvironment(output: string): DirenvEnvironment | undefined {
  // direnv emits an empty diff when the parent process already has the loaded environment.
  if (output.trim() === "") return Object.create(null);
  try {
    const parsed: unknown = JSON.parse(output);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;

    const environment: DirenvEnvironment = Object.create(null);
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value === "string" || value === null) environment[name] = value;
    }
    return environment;
  } catch {
    return undefined;
  }
}

export async function loadDirenvEnvironment(
  directory: string,
  projectDirectory: string,
  exportDirenv: ExportDirenv,
): Promise<DirenvLoadResult> {
  const envrcDirectory = findEnvrcDirectory(directory, projectDirectory);
  if (envrcDirectory === undefined) return { status: "missing" };

  try {
    const environment = parseEnvironment(await exportDirenv(envrcDirectory));
    return environment === undefined
      ? { status: "unavailable" }
      : { status: "loaded", environment };
  } catch (error) {
    return isBlocked(error) ? { status: "blocked" } : { status: "unavailable" };
  }
}

export function applyDirenvEnvironment(
  base: NodeJS.ProcessEnv,
  environment: DirenvEnvironment,
): NodeJS.ProcessEnv {
  const merged = { ...base };
  for (const [name, value] of Object.entries(environment)) {
    if (value === null) delete merged[name];
    else merged[name] = value;
  }
  return merged;
}

export function installDirenvProcessEnvironment(
  environment: DirenvEnvironment,
  target: NodeJS.ProcessEnv = process.env,
): () => void {
  const ownedValues = new Map<
    string,
    { readonly previous: string | undefined; readonly applied: string | undefined }
  >();

  for (const [name, value] of Object.entries(environment)) {
    const previous = target[name];
    const applied = value === null ? undefined : value;
    if (previous === applied) continue;

    ownedValues.set(name, { previous, applied });
    if (value === null) delete target[name];
    else target[name] = value;
  }

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;

    for (const [name, { previous, applied }] of ownedValues) {
      // Do not overwrite a value another owner changed after this direnv load.
      if (target[name] !== applied) continue;
      if (previous === undefined) delete target[name];
      else target[name] = previous;
    }
  };
}
