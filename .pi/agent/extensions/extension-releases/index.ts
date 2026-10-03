import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  DefaultPackageManager,
  type ExtensionAPI,
  getAgentDir,
  type PackageSource,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { readStartupOwnerRequest, STARTUP_OWNER_REQUEST_EVENT } from "../startup-header/contracts";
import {
  installUpdateStartupPublisher,
  readUpdateCoverage,
  type UpdateCoverage,
} from "../startup-header/updates";
import {
  checkReleases,
  createReleasePlan,
  isFreshCoverage,
  RELEASE_CACHE_TTL_MS,
  type ReleaseCoverage,
  type ReleasePackageDeclaration,
  type ReleasePlan,
} from "./release-check";

const QUERY_TIMEOUT_MS = 10_000;
const MAX_QUERY_OUTPUT_BYTES = 64 * 1024;
const CACHE_SCHEMA_VERSION = 2;
const MAX_CACHE_ENTRIES = 32;

export interface PreparedCheck {
  readonly cwd: string;
  readonly cacheFile?: string;
  readonly fingerprint: string;
  readonly npmCommand: readonly string[];
  readonly plan: ReleasePlan;
}

export interface ReleaseCheckDependencies {
  readonly prepare: (cwd: string, projectTrusted: boolean) => PreparedCheck;
  readonly readCache: (prepared: PreparedCheck, now: number) => ReleaseCoverage | undefined;
  readonly writeCache: (prepared: PreparedCheck, coverage: ReleaseCoverage) => void;
  readonly queryLatest: (
    prepared: PreparedCheck,
    name: string,
    signal: AbortSignal,
  ) => Promise<string>;
  readonly now: () => number;
  readonly schedule: (callback: () => void) => unknown;
}

const defaultDependencies: ReleaseCheckDependencies = {
  prepare: prepareCheck,
  readCache: readReleaseCache,
  writeCache: writeReleaseCache,
  queryLatest,
  now: Date.now,
  schedule: (callback) => setImmediate(callback),
};

export default function extensionReleases(
  pi: ExtensionAPI,
  dependencies: ReleaseCheckDependencies = defaultDependencies,
): void {
  let disposeCurrentRun = () => {};
  let currentSessionId: string | undefined;
  let currentCoverage: UpdateCoverage | undefined;
  let currentCoverageResult: ReleaseCoverage | undefined;
  let latestRequest: ReturnType<typeof readStartupOwnerRequest>;
  let freshnessTimer: ReturnType<typeof setTimeout> | undefined;

  pi.events.on(STARTUP_OWNER_REQUEST_EVENT, (value) => {
    const request = readStartupOwnerRequest(value);
    if (request?.ownerId !== "updates") return;
    latestRequest = request;
  });

  const publisher = installUpdateStartupPublisher(pi.events, () =>
    latestRequest?.sessionId === currentSessionId ? currentCoverage : undefined,
  );

  const publish = (coverage: ReleaseCoverage) => {
    const parsed = readUpdateCoverage(coverage);
    if (parsed === undefined) return;
    currentCoverage = parsed;
    currentCoverageResult = coverage;
    if (latestRequest?.sessionId === currentSessionId) {
      publisher.publish({
        state: parsed.coverage === "complete" ? "ready" : "degraded",
        ...(parsed.observedAt === undefined ? {} : { observedAt: parsed.observedAt }),
        ...(parsed.staleAt === undefined ? {} : { staleAt: parsed.staleAt }),
        ...(parsed.expiresAt === undefined ? {} : { expiresAt: parsed.expiresAt }),
        payload: parsed,
      });
    }
    if (freshnessTimer !== undefined) clearTimeout(freshnessTimer);
    const nextDeadline =
      coverage.staleAt > dependencies.now() ? coverage.staleAt : coverage.expiresAt;
    if (nextDeadline <= dependencies.now()) return;
    freshnessTimer = setTimeout(() => {
      if (currentCoverageResult === coverage) publish(coverage);
    }, nextDeadline - dependencies.now());
  };

  pi.on("session_start", (_event, ctx) => {
    disposeCurrentRun();
    disposeCurrentRun = () => {};
    currentCoverage = undefined;
    currentCoverageResult = undefined;
    if (freshnessTimer !== undefined) clearTimeout(freshnessTimer);
    freshnessTimer = undefined;
    currentSessionId = ctx.sessionManager.getSessionId();
    if (ctx.mode !== "tui" || typeof ctx.cwd !== "string") return;

    const controller = new AbortController();
    let active = true;
    disposeCurrentRun = () => {
      if (!active) return;
      active = false;
      controller.abort();
    };

    dependencies.schedule(() => {
      void (async () => {
        try {
          const trusted = typeof ctx.isProjectTrusted === "function" && ctx.isProjectTrusted();
          const prepared = dependencies.prepare(ctx.cwd, trusted);
          const now = dependencies.now();
          const cached = dependencies.readCache(prepared, now);
          if (cached !== undefined) {
            if (active) publish(cached);
            return;
          }
          const coverage = await checkReleases(
            prepared.plan,
            (name, signal) => dependencies.queryLatest(prepared, name, signal),
            { signal: controller.signal, now, offline: isOfflineMode() },
          );
          if (!active) return;
          if (coverage.coverage === "complete" || coverage.coverage === "partial") {
            dependencies.writeCache(prepared, coverage);
          }
          publish(coverage);
        } catch {
          if (!active) return;
          const observedAt = dependencies.now();
          publish({
            coverage: "failed",
            observedAt,
            staleAt: observedAt + RELEASE_CACHE_TTL_MS,
            expiresAt: observedAt + 2 * RELEASE_CACHE_TTL_MS,
          });
        }
      })();
    });
  });

  pi.on("session_shutdown", () => {
    disposeCurrentRun();
    disposeCurrentRun = () => {};
    currentSessionId = undefined;
    currentCoverage = undefined;
    currentCoverageResult = undefined;
    if (freshnessTimer !== undefined) clearTimeout(freshnessTimer);
    freshnessTimer = undefined;
  });
}

function prepareCheck(cwd: string, projectTrusted: boolean): PreparedCheck {
  const agentDir = getAgentDir();
  const settings = SettingsManager.create(cwd, agentDir, { projectTrusted });
  const manager = new DefaultPackageManager({ cwd, agentDir, settingsManager: settings });
  const globalSettings = settings.getGlobalSettings();
  const projectSettings = settings.getProjectSettings();
  const configured = manager.listConfiguredPackages();
  const byScopeSource = new Map(
    configured.map((entry) => [`${entry.scope}\0${entry.source}`, entry]),
  );
  const declarations: ReleasePackageDeclaration[] = [];
  const fingerprints: unknown[] = [];

  const append = (packages: readonly PackageSource[], scope: "user" | "project") => {
    for (const pkg of packages) {
      const source = typeof pkg === "string" ? pkg : pkg.source;
      const resolved = byScopeSource.get(`${scope}\0${source}`);
      const installed =
        resolved?.installedPath === undefined || !isRemotePackageSource(source)
          ? undefined
          : inspectInstalledPackage(resolved.installedPath, source);
      const extensionFilter = typeof pkg === "string" ? undefined : pkg.extensions;
      const skillFilter = typeof pkg === "string" ? undefined : pkg.skills;
      const autoload = typeof pkg === "string" ? undefined : pkg.autoload;
      declarations.push({
        source,
        scope,
        ...(extensionFilter === undefined ? {} : { extensions: extensionFilter }),
        ...(skillFilter === undefined ? {} : { skills: skillFilter }),
        ...(autoload === undefined ? {} : { autoload }),
        ...(installed?.version === undefined ? {} : { installedVersion: installed.version }),
      });
      fingerprints.push({
        source,
        scope,
        ...(typeof pkg === "string"
          ? {}
          : { extensions: pkg.extensions, skills: pkg.skills, autoload: pkg.autoload }),
        installedPath: resolved?.installedPath,
        installed: installed?.signature,
      });
    }
  };

  append(globalSettings.packages ?? [], "user");
  append(projectSettings.packages ?? [], "project");
  const plan = createReleasePlan(declarations);
  const npmCommand = settings.getNpmCommand() ?? ["npm"];
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ projectTrusted, npmCommand, packages: fingerprints }))
    .digest("hex");
  const cacheFile = resolveCacheFile(cwd);
  return {
    cwd,
    ...(cacheFile === undefined ? {} : { cacheFile }),
    fingerprint,
    npmCommand,
    plan,
  };
}

function isRemotePackageSource(source: string): boolean {
  return (
    source.startsWith("npm:") ||
    source.startsWith("git:") ||
    source.startsWith("https://") ||
    source.startsWith("http://") ||
    source.startsWith("ssh://") ||
    source.startsWith("git://") ||
    source.startsWith("git+https://") ||
    source.startsWith("git+ssh://") ||
    source.startsWith("git@")
  );
}

function inspectInstalledPackage(
  installedPath: string,
  source: string,
): {
  version?: string;
  signature: unknown;
} {
  const manifestPath = join(installedPath, "package.json");
  try {
    const stat = statSync(manifestPath);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: unknown };
    const version = typeof manifest.version === "string" ? manifest.version : undefined;
    let gitHead: string | undefined;
    if (!source.startsWith("npm:")) {
      try {
        gitHead = execFileSync("git", ["-C", installedPath, "rev-parse", "HEAD"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 500,
        }).trim();
      } catch {
        gitHead = undefined;
      }
    }
    return {
      ...(version === undefined ? {} : { version }),
      signature: { version, mtimeMs: stat.mtimeMs, size: stat.size, gitHead },
    };
  } catch {
    return { signature: null };
  }
}

function resolveCacheFile(cwd: string): string | undefined {
  const projectRoot = findProjectRoot(cwd);
  const configured = process.env.XDG_CACHE_HOME?.trim();
  const candidates = [
    ...(configured ? [resolve(configured, "pi", "extension-releases", "cache.json")] : []),
    resolve(homedir(), ".cache", "pi", "extension-releases", "cache.json"),
  ];
  return candidates.find((path) => !isWithin(projectRoot, path));
}

function findProjectRoot(cwd: string): string {
  let current = resolve(cwd);
  for (let depth = 0; depth < 32; depth += 1) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolve(cwd);
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

export function readReleaseCache(
  prepared: PreparedCheck,
  now: number,
): ReleaseCoverage | undefined {
  if (prepared.cacheFile === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(readFileSync(prepared.cacheFile, "utf8"));
    if (
      !isRecord(value) ||
      value.schemaVersion !== CACHE_SCHEMA_VERSION ||
      !isRecord(value.entries)
    )
      return undefined;
    const entry = value.entries[prepared.fingerprint];
    if (!isRecord(entry)) return undefined;
    const coverage = readUpdateCoverage(entry.coverage);
    return coverage !== undefined &&
      (coverage.coverage === "complete" || coverage.coverage === "partial") &&
      isFreshCoverage(coverage, now)
      ? coverage
      : undefined;
  } catch {
    return undefined;
  }
}

export function writeReleaseCache(prepared: PreparedCheck, coverage: ReleaseCoverage): void {
  if (prepared.cacheFile === undefined) return;
  try {
    mkdirSync(dirname(prepared.cacheFile), { recursive: true, mode: 0o700 });
    const now = Date.now();
    const entries: Record<string, unknown> = {};
    try {
      const previous: unknown = JSON.parse(readFileSync(prepared.cacheFile, "utf8"));
      if (isRecord(previous) && isRecord(previous.entries)) {
        for (const [fingerprint, value] of Object.entries(previous.entries)) {
          if (!isRecord(value)) continue;
          const cached = readUpdateCoverage(value.coverage);
          if (
            cached !== undefined &&
            (cached.coverage === "complete" || cached.coverage === "partial") &&
            isFreshCoverage(cached, now)
          ) {
            entries[fingerprint] = { coverage: cached };
          }
        }
      }
    } catch {
      // A malformed cache is replaced with the current completed observation.
    }
    delete entries[prepared.fingerprint];
    entries[prepared.fingerprint] = { coverage };
    const recentEntries = Object.entries(entries).slice(-MAX_CACHE_ENTRIES);
    const temporary = `${prepared.cacheFile}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(
      temporary,
      JSON.stringify({
        schemaVersion: CACHE_SCHEMA_VERSION,
        entries: Object.fromEntries(recentEntries),
      }),
      { mode: 0o600 },
    );
    renameSync(temporary, prepared.cacheFile);
  } catch {
    // Cache writes are best-effort; registry results remain useful without persistence.
  }
}

export function queryLatest(
  prepared: PreparedCheck,
  name: string,
  signal: AbortSignal,
): Promise<string> {
  const [command, ...args] = prepared.npmCommand;
  if (command === undefined || command.length === 0)
    return Promise.reject(new Error("Invalid npmCommand"));
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, [...args, "view", name, "version", "--json"], {
      cwd: prepared.cwd,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    let output = "";
    let settled = false;
    let terminationError: Error | undefined;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      clearTimeout(timeout);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
      signal.removeEventListener("abort", abort);
    };
    const finish = (error?: Error, value?: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error !== undefined) reject(error);
      else resolveResult(value ?? "");
    };
    const terminate = (error: Error) => {
      if (settled || terminationError !== undefined) return;
      terminationError = error;
      signalProcessTree(child, "SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (settled) return;
        signalProcessTree(child, "SIGKILL");
        child.stdout.destroy();
        finish(terminationError);
      }, 250);
    };
    const abort = () => terminate(new Error("Release query cancelled"));
    const timeout = setTimeout(
      () => terminate(new Error("Release query timed out")),
      QUERY_TIMEOUT_MS,
    );
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.stdout.on("data", (chunk: Buffer) => {
      if (settled || terminationError !== undefined) return;
      output += chunk.toString("utf8");
      if (Buffer.byteLength(output) > MAX_QUERY_OUTPUT_BYTES) {
        terminate(new Error("Release query output exceeded its limit"));
      }
    });
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (terminationError !== undefined) {
        finish(terminationError);
        return;
      }
      if (code !== 0) {
        finish(new Error(`npm view exited with status ${String(code)}`));
        return;
      }
      try {
        const parsed: unknown = JSON.parse(output.trim());
        if (typeof parsed !== "string") throw new Error("Unexpected npm view result");
        finish(undefined, parsed);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (pid === undefined) {
    child.kill(signal);
    return;
  }

  if (process.platform === "win32") {
    const fallback = () => child.kill(signal);
    try {
      const taskkill = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      let fellBack = false;
      const fallbackOnce = () => {
        if (fellBack) return;
        fellBack = true;
        fallback();
      };
      taskkill.once("error", fallbackOnce);
      taskkill.once("close", (code) => {
        if (code !== 0) fallbackOnce();
      });
    } catch {
      fallback();
    }
    return;
  }

  try {
    process.kill(-pid, signal);
  } catch {
    child.kill(signal);
  }
}

function isOfflineMode(): boolean {
  const value = process.env.PI_OFFLINE?.toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
