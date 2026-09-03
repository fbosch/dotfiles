import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

const LOCK_ATTEMPTS = 10;
const LOCK_RETRY_DELAY_MS = 20;
const STALE_LOCK_MS = 10_000;
const sleepBuffer = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

export function readLockedJsonFile(path: string): unknown {
  if (existsSync(path) === false) return undefined;

  return withFileLock(path, (assertOwned) => {
    assertOwned();
    return JSON.parse(readFileSync(path, "utf8"));
  });
}

export function updateLockedJsonFile(path: string, update: (current: unknown) => unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  withFileLock(path, (assertOwned) => {
    const current = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
    const updated = update(current);
    assertOwned();
    writeJsonAtomically(path, updated);
  });
}

interface AcquiredLock {
  assertOwned(): void;
  releaseIfOwned(): void;
}

function withFileLock<T>(path: string, operation: (assertOwned: () => void) => T): T {
  const lock = acquireFileLock(path);
  try {
    return operation(lock.assertOwned);
  } finally {
    lock.releaseIfOwned();
  }
}

function acquireFileLock(path: string): AcquiredLock {
  // Match Pi's proper-lockfile protocol so extension writes serialize with core settings updates.
  const lockPath = `${path}.lock`;

  for (let attempt = 1; attempt <= LOCK_ATTEMPTS; attempt += 1) {
    try {
      mkdirSync(lockPath);
      const identity = lockIdentity(lockPath);
      const isOwned = () => sameLock(lockPath, identity);
      return {
        assertOwned: () => {
          if (isOwned() === false) {
            throw new Error(`Cannot access ${path}: settings lock ownership was lost`);
          }
        },
        releaseIfOwned: () => {
          if (isOwned()) rmdirSync(lockPath);
        },
      };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      if (removeStaleLock(lockPath)) continue;
      if (attempt === LOCK_ATTEMPTS) {
        throw new Error(`Cannot access ${path}: settings file is locked by another process`);
      }
      Atomics.wait(sleepBuffer, 0, 0, LOCK_RETRY_DELAY_MS);
    }
  }

  throw new Error(`Cannot access ${path}: failed to acquire settings lock`);
}

interface LockIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly mtimeMs: number;
}

function lockIdentity(lockPath: string): LockIdentity {
  const { dev, ino, mtimeMs } = statSync(lockPath);
  return { dev, ino, mtimeMs };
}

function sameLock(lockPath: string, identity: LockIdentity): boolean {
  try {
    const current = lockIdentity(lockPath);
    return (
      current.dev === identity.dev &&
      current.ino === identity.ino &&
      current.mtimeMs === identity.mtimeMs
    );
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

function removeStaleLock(lockPath: string): boolean {
  try {
    if (statSync(lockPath).mtimeMs >= Date.now() - STALE_LOCK_MS) return false;
    rmdirSync(lockPath);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return true;
    return false;
  }
}

function writeJsonAtomically(path: string, value: unknown): void {
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    const existingMode = fileMode(path);
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      ...(existingMode === undefined ? {} : { mode: existingMode }),
    });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function fileMode(path: string): number | undefined {
  try {
    return statSync(path).mode & 0o777;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}
