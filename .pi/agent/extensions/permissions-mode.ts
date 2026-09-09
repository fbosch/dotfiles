import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  analyzeDangerousCommand,
  areDangerousCommandTargetsSafeInLocations,
} from "./pi-permission-system/dangerous-command";

export const PERMISSIONS_STRICT_STATUS_KEY = "permissions-strict";
export const PERMISSIONS_STRICT_STATUS_TEXT = " strict";
export const PERMISSIONS_STRICT_STATE_CHANNEL = "pi-permissions:strict-state";

const PERMISSIONS_MODE_ENTRY_TYPE = "permissions-mode";
const SESSION_PERMISSIONS_AUTHORIZER = "session-permissions-mode";
const PERMISSIONS_READY_CHANNEL = "permissions:ready";

const BUILD_AGENT_NAMES = new Set([
  "adversarial",
  "benchmark",
  "debug",
  "docs",
  "general",
  "pr-feedback",
  "quick",
  "refactor",
  "test",
  "validate",
]);

// Safe roots are shared by every supported dangerous command rule.
export const SAFE_DANGEROUS_COMMAND_PATHS = ["/tmp"] as const;
const PERMISSION_SERVICE_MODULE_URL = new URL(
  "../npm/node_modules/@gotgenes/pi-permission-system/src/service.ts",
  import.meta.url,
).href;
const BASH_PARSER_MODULE_URL = new URL(
  "../npm/node_modules/@gotgenes/pi-permission-system/src/access-intent/bash/parser.ts",
  import.meta.url,
).href;

export interface PermissionsStrictStateEvent {
  sessionId: string;
  strictEnabled: boolean;
}

interface PersistedPermissionsMode {
  sessionId: string;
  strictEnabled: boolean;
}

type RegistrationState = "not_ready" | "registering" | "registered" | "failed";
type PermissionVerdict = { kind: "allow" } | { kind: "defer" };
type PermissionAuthorizer = (details: unknown) => Promise<PermissionVerdict>;

interface SessionPermissions {
  registerAuthorizer(name: string, authorize: PermissionAuthorizer): () => void;
}

interface PermissionSystemServiceModule {
  getPermissionsService(sessionId: string): SessionPermissions | undefined;
}

interface BashParserModule {
  getParser(): Promise<{
    parse(source: string): { rootNode: { hasError: boolean }; delete(): void } | null;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getSessionId(ctx: Pick<ExtensionContext, "sessionManager">): string | undefined {
  return ctx.sessionManager.getHeader()?.id;
}

function restoreStrictMode(ctx: Pick<ExtensionContext, "sessionManager">): boolean {
  const sessionId = getSessionId(ctx);
  if (sessionId === undefined) return false;

  let strictEnabled = false;
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "custom" || entry.customType !== PERMISSIONS_MODE_ENTRY_TYPE) continue;
    if (!isRecord(entry.data) || entry.data.sessionId !== sessionId) continue;
    if (typeof entry.data.strictEnabled !== "boolean") continue;
    strictEnabled = entry.data.strictEnabled;
  }
  return strictEnabled;
}

export function isPermissionsStrictStateEvent(
  value: unknown,
): value is PermissionsStrictStateEvent {
  return (
    isRecord(value) &&
    typeof value.sessionId === "string" &&
    value.sessionId.length > 0 &&
    typeof value.strictEnabled === "boolean"
  );
}

function publishStrictState(
  pi: ExtensionAPI,
  ctx: Pick<ExtensionContext, "sessionManager" | "ui">,
  strictEnabled: boolean,
): void {
  const sessionId = getSessionId(ctx);
  if (sessionId !== undefined) {
    pi.events.emit(PERMISSIONS_STRICT_STATE_CHANNEL, { sessionId, strictEnabled });
  }
  ctx.ui.setStatus(
    PERMISSIONS_STRICT_STATUS_KEY,
    strictEnabled ? ctx.ui.theme.fg("warning", PERMISSIONS_STRICT_STATUS_TEXT) : undefined,
  );
}

function permissionSurface(details: Record<string, unknown>): unknown {
  const intent = isRecord(details.accessIntent) ? details.accessIntent : undefined;
  return intent?.surface ?? details.surface ?? details.toolName;
}

function commandTexts(details: Record<string, unknown>): string[] {
  const intent = isRecord(details.accessIntent) ? details.accessIntent : undefined;
  const payload = isRecord(details.payload) ? details.payload : undefined;
  const request = isRecord(payload?.request) ? payload.request : undefined;
  const evidence = Array.isArray(payload?.evidence) ? payload.evidence : [];
  const fullCommands = evidence.flatMap((item) => {
    if (!isRecord(item) || item.label !== "full command" || typeof item.text !== "string") {
      return [];
    }
    return [item.text];
  });
  return [
    details.command,
    details.value,
    request?.value,
    ...fullCommands,
    ...(Array.isArray(intent?.matchValues) ? intent.matchValues : []),
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

async function isParseableShell(command: string): Promise<boolean> {
  const { getParser } = (await import(BASH_PARSER_MODULE_URL)) as BashParserModule;
  const tree = (await getParser()).parse(command);
  if (tree === null) return false;
  try {
    return !tree.rootNode.hasError;
  } finally {
    tree.delete();
  }
}

/**
 * Normal mode allows ordinary policy asks automatically. Dangerous Bash is also
 * allowed when every literal destructive target stays below the session CWD, or
 * when a build agent uses one of the shared safe roots. Strict mode is checked
 * first by the authorizer and always defers. Missing details, ambiguous paths,
 * and parser/import failures remain interactive.
 */
export async function canAutoApprovePermission(
  details: unknown,
  workingDirectory = process.cwd(),
): Promise<boolean> {
  if (!isRecord(details)) return false;
  const surface = permissionSurface(details);
  if (typeof surface !== "string") return false;
  if (surface !== "bash") return true;

  const agentName = typeof details.agentName === "string" ? details.agentName : undefined;
  const commands = commandTexts(details);
  if (commands.length === 0) return false;

  const safeLocations = [
    workingDirectory,
    ...(agentName !== undefined && BUILD_AGENT_NAMES.has(agentName)
      ? SAFE_DANGEROUS_COMMAND_PATHS
      : []),
  ];

  try {
    for (const command of new Set(commands)) {
      if (!(await isParseableShell(command))) return false;
      const analysis = await analyzeDangerousCommand(["bash", "-lc", command]);
      if (analysis.kind === "unknown") return false;
      if (
        analysis.kind === "dangerous" &&
        !(await areDangerousCommandTargetsSafeInLocations(command, safeLocations, workingDirectory))
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function readySessionId(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.sessionId !== "string") return undefined;
  return value.sessionId.length > 0 ? value.sessionId : undefined;
}

async function registerSessionAuthorizer(
  sessionId: string,
  isCurrent: () => boolean,
  strictEnabled: () => boolean,
  workingDirectory: () => string,
): Promise<() => void> {
  const serviceModule = (await import(
    PERMISSION_SERVICE_MODULE_URL
  )) as PermissionSystemServiceModule;
  const permissions = serviceModule.getPermissionsService(sessionId);
  if (permissions === undefined) {
    throw new Error(`Permission service is unavailable for session '${sessionId}'.`);
  }

  return permissions.registerAuthorizer(SESSION_PERMISSIONS_AUTHORIZER, async (details) => {
    if (!isCurrent() || strictEnabled()) return { kind: "defer" };
    const allowed = await canAutoApprovePermission(details, workingDirectory());
    return isCurrent() && !strictEnabled() && allowed ? { kind: "allow" } : { kind: "defer" };
  });
}

export function registerPermissionsMode(pi: ExtensionAPI): void {
  let strictEnabled = false;
  let registrationState: RegistrationState = "not_ready";
  let activeContext: ExtensionContext | undefined;
  let activeSessionId: string | undefined;
  let disposeAuthorizer: (() => void) | undefined;
  let lifecycleGeneration = 0;

  pi.on("session_start", (_event, ctx) => {
    lifecycleGeneration++;
    registrationState = "not_ready";
    disposeAuthorizer?.();
    disposeAuthorizer = undefined;

    activeContext = ctx;
    activeSessionId = getSessionId(ctx);
    strictEnabled = restoreStrictMode(ctx);
    publishStrictState(pi, ctx, strictEnabled);
  });

  const disposeReadyListener = pi.events.on(PERMISSIONS_READY_CHANNEL, (value: unknown) => {
    const sessionId = readySessionId(value);
    if (sessionId === undefined || sessionId !== activeSessionId) return;
    if (registrationState === "registered" || registrationState === "registering") return;

    const generation = lifecycleGeneration;
    registrationState = "registering";
    void registerSessionAuthorizer(
      sessionId,
      () =>
        generation === lifecycleGeneration &&
        sessionId === activeSessionId &&
        registrationState === "registered",
      () => strictEnabled,
      () => activeContext?.cwd ?? process.cwd(),
    )
      .then((dispose) => {
        if (generation !== lifecycleGeneration || sessionId !== activeSessionId) {
          dispose();
          return;
        }
        disposeAuthorizer = dispose;
        registrationState = "registered";
      })
      .catch((error: unknown) => {
        if (generation !== lifecycleGeneration || sessionId !== activeSessionId) return;
        registrationState = "failed";
        activeContext?.ui.notify(
          `Could not start automatic permission checks: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      });
  });

  pi.on("session_shutdown", () => {
    lifecycleGeneration++;
    registrationState = "not_ready";
    disposeAuthorizer?.();
    disposeAuthorizer = undefined;
    disposeReadyListener();
    activeContext = undefined;
    activeSessionId = undefined;
    strictEnabled = false;
  });

  pi.registerCommand("permissions", {
    description: "Set automatic or strict permission prompts",
    handler: async (args, ctx) => {
      const mode = args.trim();
      if (mode !== "strict" && mode !== "normal") {
        ctx.ui.notify("Usage: /permissions strict|normal", "warning");
        return;
      }

      try {
        const sessionId = getSessionId(ctx);
        if (sessionId === undefined || sessionId !== activeSessionId) {
          ctx.ui.notify("Cannot change permissions without the active session.", "error");
          return;
        }

        const nextStrictEnabled = mode === "strict";
        pi.appendEntry<PersistedPermissionsMode>(PERMISSIONS_MODE_ENTRY_TYPE, {
          sessionId,
          strictEnabled: nextStrictEnabled,
        });
        strictEnabled = nextStrictEnabled;
        publishStrictState(pi, ctx, strictEnabled);
        ctx.ui.notify(
          strictEnabled
            ? "Strict permissions enabled. Every permission request requires confirmation."
            : "Normal permissions enabled. Destructive commands outside approved roots and unclassifiable commands require confirmation.",
          "info",
        );
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}

export default function permissionsMode(pi: ExtensionAPI): void {
  registerPermissionsMode(pi);
}
