import { access, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { LspLanguage, LspServerSettings } from "./settings";

export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

export interface ProjectFile {
  readonly canonicalPath: string;
  readonly languageId: string;
  readonly path: string;
  readonly text: string;
}

function containedBy(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || (child.startsWith(`..${sep}`) === false && child !== "..");
}

export function languageForPath(server: LspServerSettings, path: string): LspLanguage | undefined {
  const name = basename(path);
  const extension = extname(path);
  return server.languages.find(
    (language) => language.fileNames.includes(name) || language.extensions.includes(extension),
  );
}

export async function canonicalProjectRoot(cwd: string): Promise<string> {
  return realpath(resolve(cwd));
}

export async function readProjectFile(
  projectRoot: string,
  inputPath: string,
  languageId: string,
  allowAbsolute = false,
): Promise<ProjectFile> {
  if (isAbsolute(inputPath) && allowAbsolute === false) {
    throw new Error("LSP paths must be relative to the project root");
  }
  const path = resolve(projectRoot, inputPath);
  if (containedBy(projectRoot, path) === false)
    throw new Error("LSP path is outside the project root");
  const canonicalPath = await realpath(path);
  if (containedBy(projectRoot, canonicalPath) === false) {
    throw new Error("LSP path resolves outside the project root");
  }
  const metadata = await stat(canonicalPath);
  if (metadata.isFile() === false) throw new Error("LSP path is not a regular file");
  if (metadata.size > MAX_DOCUMENT_BYTES) throw new Error("LSP document exceeds 2 MiB");
  return { canonicalPath, languageId, path, text: await readFile(canonicalPath, "utf8") };
}

export async function findServerRoot(
  projectRoot: string,
  filePath: string,
  markers: readonly string[],
): Promise<string | undefined> {
  let directory = dirname(filePath);
  for (;;) {
    for (const marker of markers) {
      try {
        await access(resolve(directory, marker));
        return directory;
      } catch {
        // Continue through configured markers.
      }
    }
    if (directory === projectRoot) return undefined;
    const parent = dirname(directory);
    if (parent === directory || containedBy(projectRoot, parent) === false) return undefined;
    directory = parent;
  }
}

export function projectRelativePath(projectRoot: string, path: string): string {
  return relative(projectRoot, path).split(sep).join("/");
}

export function isInsideProject(projectRoot: string, path: string): boolean {
  return containedBy(projectRoot, path);
}
