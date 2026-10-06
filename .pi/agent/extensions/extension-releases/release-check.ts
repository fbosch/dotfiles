export interface ReleasePackageDeclaration {
  readonly source: string;
  readonly scope: "user" | "project";
  readonly extensions?: readonly string[];
  readonly skills?: readonly string[];
  readonly autoload?: boolean;
  readonly installedVersion?: string;
}

export interface NpmReleaseCandidate {
  readonly name: string;
  readonly source: string;
  readonly scope: "user" | "project";
  readonly baseline: string;
}

export interface ReleasePlan {
  readonly npm: readonly NpmReleaseCandidate[];
  readonly gitNotChecked: number;
  readonly unsupported: number;
}

export interface ReleaseUpdate {
  readonly name: string;
  readonly current: string;
  readonly latest: string;
  readonly scope: "user" | "project";
}

export interface ReleaseCoverage {
  readonly coverage: "complete" | "partial" | "offline" | "failed";
  readonly available?: number;
  readonly updates?: readonly ReleaseUpdate[];
  readonly gitNotChecked?: number;
  readonly unsupported?: number;
  readonly failed?: number;
  readonly observedAt: number;
  readonly staleAt: number;
  readonly expiresAt: number;
}

export const RELEASE_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

export function createReleasePlan(packages: readonly ReleasePackageDeclaration[]): ReleasePlan {
  const selected = new Map<string, ReleasePackageDeclaration>();
  const projectDeltas = new Map<string, ReleasePackageDeclaration>();
  for (const entry of packages) {
    const identity = packageIdentity(entry.source);
    if (identity === undefined) continue;
    if (entry.scope === "project" && entry.autoload === false) {
      projectDeltas.set(identity, entry);
      continue;
    }
    const existing = selected.get(identity);
    if (existing === undefined || entry.scope === "project") selected.set(identity, entry);
  }
  for (const [identity, delta] of projectDeltas) {
    if (!selected.has(identity)) selected.set(identity, delta);
  }

  const npm: NpmReleaseCandidate[] = [];
  let gitNotChecked = 0;
  let unsupported = 0;
  for (const [identity, entry] of selected) {
    const delta = entry.scope === "user" ? projectDeltas.get(identity) : undefined;
    const extensions = selectEffectiveExtensions(entry, delta);
    if (extensions.incomplete) unsupported += 1;
    if (!extensions.enabled) continue;
    const source = entry.source;
    if (source.startsWith("npm:")) {
      const parsed = parseNpmSource(source);
      if (parsed === undefined) {
        unsupported += 1;
        continue;
      }
      const baseline = isSemver(entry.installedVersion) ? entry.installedVersion : parsed.version;
      if (!isSemver(baseline)) {
        unsupported += 1;
        continue;
      }
      npm.push({ name: parsed.name, source, scope: entry.scope, baseline });
      continue;
    }
    if (isGitSource(source)) {
      gitNotChecked += 1;
      continue;
    }
    if (isUnknownRemoteSource(source)) unsupported += 1;
  }

  return {
    npm: Object.freeze(npm),
    gitNotChecked,
    unsupported,
  };
}

export async function checkReleases(
  plan: ReleasePlan,
  queryLatest: (name: string, signal: AbortSignal) => Promise<string>,
  options: { readonly signal: AbortSignal; readonly now: number; readonly offline?: boolean },
): Promise<ReleaseCoverage> {
  const observedAt = options.now;
  const staleAt = observedAt + RELEASE_CACHE_TTL_MS;
  const expiresAt = observedAt + 2 * RELEASE_CACHE_TTL_MS;
  const freshness = { observedAt, staleAt, expiresAt };
  const incomplete = plan.gitNotChecked > 0 || plan.unsupported > 0;
  if (options.offline) {
    return {
      coverage: "offline",
      ...freshness,
      ...(plan.gitNotChecked === 0 ? {} : { gitNotChecked: plan.gitNotChecked }),
      ...(plan.unsupported === 0 ? {} : { unsupported: plan.unsupported }),
    };
  }

  let available = 0;
  let checked = 0;
  let failed = 0;
  const updates: ReleaseUpdate[] = [];
  await mapWithConcurrency(plan.npm, 3, async (candidate) => {
    if (options.signal.aborted) return;
    try {
      const latest = await queryLatest(candidate.name, options.signal);
      if (!isSemver(latest)) throw new Error("Registry returned an invalid version");
      checked += 1;
      if (compareSemver(latest, candidate.baseline) > 0) {
        available += 1;
        if (updates.length < 100)
          updates.push(
            Object.freeze({
              name: candidate.name,
              current: candidate.baseline,
              latest,
              scope: candidate.scope,
            }),
          );
      }
    } catch {
      failed += 1;
    }
  });

  if (options.signal.aborted) throw new Error("Release check was cancelled");
  const hasFailures = failed > 0;
  const coverage =
    hasFailures && checked === 0 ? "failed" : incomplete || hasFailures ? "partial" : "complete";
  return {
    coverage,
    ...(coverage === "failed" ? {} : { available, updates: Object.freeze(updates) }),
    ...(plan.gitNotChecked === 0 ? {} : { gitNotChecked: plan.gitNotChecked }),
    ...(plan.unsupported === 0 ? {} : { unsupported: plan.unsupported }),
    ...(failed === 0 ? {} : { failed }),
    ...freshness,
  };
}

export function isFreshCoverage(value: unknown, now: number): value is ReleaseCoverage {
  if (!isRecord(value) || !isTimestamp(value.observedAt) || !isTimestamp(value.staleAt))
    return false;
  if (
    !isTimestamp(value.expiresAt) ||
    value.observedAt > now ||
    value.staleAt < value.observedAt ||
    value.expiresAt < value.staleAt ||
    value.expiresAt <= now ||
    value.staleAt <= now
  )
    return false;
  if (
    value.coverage !== "complete" &&
    value.coverage !== "partial" &&
    value.coverage !== "offline" &&
    value.coverage !== "failed"
  )
    return false;
  if (value.coverage === "complete" || value.coverage === "partial") {
    if (!Number.isSafeInteger(value.available) || (value.available as number) < 0) return false;
  }
  if (value.updates !== undefined && !isReleaseUpdates(value.updates)) return false;
  for (const key of ["gitNotChecked", "unsupported", "failed"] as const) {
    if (
      value[key] !== undefined &&
      (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0)
    )
      return false;
  }
  return true;
}

function isReleaseUpdates(value: unknown): value is readonly ReleaseUpdate[] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.name === "string" &&
        /^[a-zA-Z0-9@._/-]{1,214}$/.test(entry.name) &&
        typeof entry.current === "string" &&
        isSemver(entry.current) &&
        typeof entry.latest === "string" &&
        isSemver(entry.latest) &&
        (entry.scope === "user" || entry.scope === "project") &&
        compareSemver(entry.latest, entry.current) > 0,
    )
  );
}

export function isSemver(value: string | undefined): value is string {
  return value !== undefined && parseSemver(value) !== undefined;
}

export function compareSemver(left: string, right: string): number {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) throw new TypeError("Cannot compare invalid semantic versions");
  for (let index = 0; index < 3; index += 1) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return Math.sign(b.prerelease.length - a.prerelease.length);
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) return leftPart === undefined ? -1 : 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return BigInt(leftPart) < BigInt(rightPart) ? -1 : 1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function parseSemver(
  value: string,
): { core: readonly number[]; prerelease: readonly string[] } | undefined {
  const match =
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      value,
    );
  if (match === null) return undefined;
  const core = match.slice(1, 4).map(Number);
  if (core.some((part) => !Number.isSafeInteger(part))) return undefined;
  const prerelease = match[4] === undefined ? [] : match[4].split(".");
  if (
    prerelease.some(
      (part) => part === "" || (/^\d+$/.test(part) && part.length > 1 && part.startsWith("0")),
    )
  )
    return undefined;
  return { core, prerelease };
}

function parseNpmSource(source: string): { name: string; version?: string } | undefined {
  const spec = source.slice("npm:".length);
  const match = /^(@[^/]+\/[^@]+|[^/@]+)(?:@(.+))?$/.exec(spec);
  if (match === null || match[1] === undefined) return undefined;
  return { name: match[1], ...(match[2] === undefined ? {} : { version: match[2] }) };
}

function packageIdentity(source: string): string | undefined {
  if (source.startsWith("npm:")) {
    const parsed = parseNpmSource(source);
    return parsed === undefined ? undefined : `npm:${parsed.name}`;
  }
  if (isGitSource(source)) return `git:${gitRepositoryIdentity(source)}`;
  if (isUnknownRemoteSource(source)) return `remote:${source}`;
  return undefined;
}

function gitRepositoryIdentity(source: string): string {
  let repository = source.startsWith("git:") ? source.slice("git:".length) : source;
  if (repository.startsWith("git@")) {
    repository = repository.replace(/^git@([^:]+):/, "$1/");
  } else {
    repository = repository.replace(/^(?:git\+)?(?:https?|ssh|git):\/\//, "");
  }
  const refAt = repository.lastIndexOf("@");
  const pathStart = repository.indexOf("/");
  if (refAt > pathStart && pathStart >= 0) repository = repository.slice(0, refAt);
  return repository
    .replace(/\.git$/, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

function selectEffectiveExtensions(
  entry: ReleasePackageDeclaration,
  projectDelta?: ReleasePackageDeclaration,
): { enabled: boolean; incomplete: boolean } {
  const baseEnabled = hasEnabledAutoloadExtensions(entry.extensions, entry.autoload);
  const deltaPatterns = projectDelta?.extensions;
  if (deltaPatterns === undefined || deltaPatterns.length === 0) {
    return { enabled: baseEnabled, incomplete: false };
  }

  const basePatterns = entry.extensions ?? [];
  if (entry.autoload === false || entry.extensions !== undefined) {
    const baseFiltersArePaths =
      entry.autoload === false || basePatterns.every((pattern) => !/^[+!-]/.test(pattern));
    if (baseFiltersArePaths && patternsAreExactResourcePaths([...basePatterns, ...deltaPatterns])) {
      const states = new Map<string, boolean>();
      if (entry.autoload === false) {
        applyAutoloadExtensionPatterns(states, basePatterns);
      } else {
        for (const pattern of basePatterns) states.set(pattern, true);
      }
      applyAutoloadExtensionPatterns(states, deltaPatterns);
      return { enabled: [...states.values()].some(Boolean), incomplete: false };
    }
    return {
      enabled: baseEnabled || hasEnabledAutoloadExtensions(deltaPatterns, false),
      incomplete: true,
    };
  }

  return {
    enabled: baseEnabled || hasEnabledAutoloadExtensions(deltaPatterns, false),
    incomplete: deltaPatterns.some((pattern) => pattern.startsWith("-") || pattern.startsWith("!")),
  };
}

function hasEnabledAutoloadExtensions(
  patterns: readonly string[] | undefined,
  autoload?: boolean,
): boolean {
  if (patterns !== undefined && patterns.length === 0) return false;
  if (autoload === false) {
    if (patterns === undefined) return false;
    const states = new Map<string, boolean>();
    applyAutoloadExtensionPatterns(states, patterns);
    return [...states.values()].some(Boolean);
  }
  return true;
}

function applyAutoloadExtensionPatterns(
  states: Map<string, boolean>,
  patterns: readonly string[],
): void {
  for (const pattern of patterns) {
    const target = pattern.replace(/^[+!-]/, "");
    if (target.length === 0) continue;
    states.set(target, !pattern.startsWith("-") && !pattern.startsWith("!"));
  }
}

function patternsAreExactResourcePaths(patterns: readonly string[]): boolean {
  return patterns.every((pattern) => !/[?*{}[\]]/.test(pattern.replace(/^[+!-]/, "")));
}

function isGitSource(source: string): boolean {
  return (
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

function isUnknownRemoteSource(source: string): boolean {
  return (
    !/^[A-Za-z]:[\\/]/.test(source) &&
    /^[a-z][a-z0-9+.-]*:/i.test(source) &&
    !source.startsWith("file:")
  );
}

async function mapWithConcurrency<T>(
  values: readonly T[],
  limit: number,
  worker: (value: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers: Promise<void>[] = [];
  for (let index = 0; index < Math.min(limit, values.length); index += 1) {
    workers.push(
      (async () => {
        while (next < values.length) {
          const valueIndex = next++;
          const value = values[valueIndex];
          if (value !== undefined) await worker(value);
        }
      })(),
    );
  }
  await Promise.all(workers);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
