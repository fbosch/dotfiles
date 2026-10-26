import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const safeName = (value: string) => value.replace(/[^A-Za-z0-9_-]/gu, "_");

/** Reads a correctly named regular file directly within a cache session directory. */
export async function readSavedArtifact(
  root: string,
  path: string,
  entryId: string,
  bytes: number,
) {
  const rel = relative(resolve(root), resolve(path));
  const parts = rel.split(sep);
  if (
    isAbsolute(rel) ||
    parts.length !== 2 ||
    !/^[A-Za-z0-9_-]+$/u.test(parts[0] ?? "") ||
    basename(path) !== `${safeName(entryId)}.txt`
  )
    throw new Error("Invalid saved-result path");
  const canonicalRoot = await realpath(root);
  const dir = await realpath(dirname(path));
  // Reject symlinked session directories as well as symlinked files.
  if (dir !== join(canonicalRoot, parts[0] ?? ""))
    throw new Error("Invalid saved-result directory");
  const file = await open(
    join(dir, basename(path)),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error("Saved result is not a regular file");
    const buffer = Buffer.alloc(Math.min(stat.size, bytes));
    let length = 0;
    while (length < buffer.length) {
      const next = await file.read(buffer, length, buffer.length - length, length);
      if (next.bytesRead === 0) break;
      length += next.bytesRead;
    }
    const partial = stat.size > length;
    return {
      text: new TextDecoder().decode(buffer.subarray(0, length), { stream: partial }),
      bytes: length,
      totalBytes: stat.size,
      partial,
    };
  } finally {
    await file.close();
  }
}
