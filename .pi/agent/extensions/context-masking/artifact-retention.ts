import { randomUUID } from "node:crypto";
import {
  existsSync, linkSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isMatching, P } from "ts-pattern";
import { updateLockedJsonFile } from "../../lib/locked-json-file";
import type { MaskingSettings } from "./policy";

const DAY_MS = 86_400_000;
const SESSION_NAME = /^[A-Za-z0-9_-]+$/u;
const safeName = (value: string) => value.replace(/[^A-Za-z0-9_-]/gu, "_");
type RetentionSettings = Pick<MaskingSettings, "retentionDays" | "retainedSessionIds">;
interface SessionActivity {
  lastActiveAt: number;
  owners: Record<string, { pid: number; host: string }>;
}
interface RetentionState {
  version: 1;
  sessions: Record<string, SessionActivity>;
}
const StatePattern = {
  version: 1 as const,
  sessions: P.record(P.string.regex(SESSION_NAME), {
    lastActiveAt: P.number.gte(0),
    owners: P.record(P.string, { pid: P.number.int().gte(1), host: P.string }),
  }),
};

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Only ESRCH proves that an owner is dead; permissions and unknown errors preserve it.
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}

/** Serializes leases and expiry across Pi processes sharing this cache. */
export class ArtifactRetention {
  private readonly owner = randomUUID();
  private session: string | undefined;

  constructor(
    private readonly root: string,
    private readonly now = Date.now,
    private readonly alive = processAlive,
  ) {}

  start(sessionId: string, settings: RetentionSettings): void {
    if (!sessionId) throw new Error("Invalid cache session ID");
    if (this.session !== undefined) this.stop();
    const session = safeName(sessionId);
    const abandoned: string[] = [];
    this.update((state, assertOwned, moved) => {
      const now = this.now();
      const current = this.activity(state, session, now);
      current.lastActiveAt = now;
      current.owners[this.owner] = { pid: process.pid, host: hostname() };
      const retained = new Set(settings.retainedSessionIds.map(safeName));
      // Existing caches have no activity history. Start their clock now, never from file age.
      for (const entry of readdirSync(this.root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (SESSION_NAME.test(entry.name)) this.activity(state, entry.name, now);
        // A crashed cleanup may have committed expiry without finishing directory deletion.
        if (/^\.expired-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(entry.name))
          abandoned.push(join(this.root, entry.name));
      }
      for (const [id, activity] of Object.entries(state.sessions)) {
        for (const [owner, identity] of Object.entries(activity.owners)) {
          if (identity.host === hostname() && !this.alive(identity.pid))
            delete activity.owners[owner];
        }
        if (
          settings.retentionDays === 0 || retained.has(id) ||
          Object.keys(activity.owners).length > 0 ||
          now - activity.lastActiveAt < settings.retentionDays * DAY_MS
        ) continue;
        const directory = join(this.root, id);
        if (existsSync(directory)) {
          if (!lstatSync(directory).isDirectory()) continue;
          // Quarantine under the lease lock; slow deletion happens only after metadata commits.
          const expired = join(this.root, `.expired-${randomUUID()}`);
          assertOwned();
          renameSync(directory, expired);
          moved.push({ directory, expired });
        }
        delete state.sessions[id];
      }
    });
    this.session = session;
    for (const expired of abandoned) rmSync(expired, { recursive: true, force: true });
  }

  touch(): void {
    const session = this.session;
    if (session === undefined) return;
    this.update((state) => {
      this.activity(state, session, this.now()).lastActiveAt = this.now();
    });
  }

  stop(): void {
    const session = this.session;
    if (session === undefined) return;
    this.update((state) => {
      const activity = this.activity(state, session, this.now());
      activity.lastActiveAt = this.now();
      delete activity.owners[this.owner];
    });
    this.session = undefined;
  }

  private activity(state: RetentionState, id: string, now: number): SessionActivity {
    if (!Object.hasOwn(state.sessions, id))
      state.sessions = { ...state.sessions, [id]: { lastActiveAt: now, owners: {} } };
    const activity = state.sessions[id];
    if (activity === undefined) throw new Error("Missing cache session activity");
    return activity;
  }

  private update(
    operation: (
      state: RetentionState,
      assertOwned: () => void,
      moved: Array<{ directory: string; expired: string }>,
    ) => void,
  ): void {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    if (!lstatSync(this.root).isDirectory()) throw new Error("Invalid cache root");
    const path = join(this.root, ".retention.json");
    if (!existsSync(path)) {
      const temporary = join(this.root, `.retention-${randomUUID()}.tmp`);
      try {
        writeFileSync(temporary, JSON.stringify({ version: 1, sessions: {} }), { flag: "wx", mode: 0o600 });
        // Publish complete metadata without overwriting a concurrent initializer.
        linkSync(temporary, path);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      } finally {
        rmSync(temporary, { force: true });
      }
    }
    if (!lstatSync(path).isFile()) throw new Error("Invalid cache retention file");
    const moved: Array<{ directory: string; expired: string }> = [];
    try {
      updateLockedJsonFile(path, (value, assertOwned) => {
        if (
          !isMatching(StatePattern, value) ||
          Object.values(value.sessions).some((activity) => !Number.isFinite(activity.lastActiveAt))
        ) throw new Error("Invalid cache retention metadata");
        operation(value, assertOwned, moved);
        return value;
      });
    } catch (error) {
      for (const { directory, expired } of moved.reverse()) renameSync(expired, directory);
      throw error;
    }
    for (const { expired } of moved) rmSync(expired, { recursive: true });
  }
}

export function registerArtifactRetention(
  pi: Pick<ExtensionAPI, "on">,
  dependencies: {
    artifactRoot: () => string;
    settings: (ctx: ExtensionContext) => RetentionSettings;
    now?: () => number;
  },
): void {
  let retention: ArtifactRetention | undefined;
  pi.on("session_start", (_event, ctx) => {
    const settings = dependencies.settings(ctx);
    retention ??= new ArtifactRetention(dependencies.artifactRoot(), dependencies.now);
    retention.start(ctx.sessionManager.getSessionId(), settings);
  });
  pi.on("before_agent_start", () => { retention?.touch(); });
  pi.on("agent_end", () => { retention?.touch(); });
  pi.on("session_tree", () => { retention?.touch(); });
  pi.on("session_shutdown", () => { retention?.stop(); });
}
