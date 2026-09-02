import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const PERMISSION_SYSTEM_STATUS_KEY = "pi-permission-system";
export const YOLO_STATUS_TEXT = "󱚝 yolo";

const YOLO_MODE_ENTRY_TYPE = "yolo-mode";
const SESSION_YOLO_AUTHORIZER = "session-yolo";
const PERMISSIONS_READY_CHANNEL = "permissions:ready";
// shortcut: Pi isolates npm package module roots, so use the pinned package
// source URL for its documented service accessor until local extensions share
// the package resolution root.
const PERMISSION_SERVICE_MODULE_URL = new URL(
  "../npm/node_modules/@gotgenes/pi-permission-system/src/service.ts",
  import.meta.url,
).href;

interface PersistedYoloMode {
  sessionId: string;
  enabled: boolean;
}

type SessionYoloVerdict = { kind: "allow" } | { kind: "defer" };

type SessionYoloAuthorizer = (...args: never[]) => Promise<SessionYoloVerdict>;

interface SessionYoloPermissions {
  registerAuthorizer(name: string, authorize: SessionYoloAuthorizer): () => void;
}

interface PermissionSystemServiceModule {
  getPermissionsService(sessionId: string): SessionYoloPermissions | undefined;
}

export interface YoloModeToggleResult {
  enabled: boolean;
  sessionId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function getSessionId(ctx: Pick<ExtensionContext, "sessionManager">): string | undefined {
  return ctx.sessionManager.getHeader()?.id;
}

function restoreYoloMode(ctx: Pick<ExtensionContext, "sessionManager">): boolean {
  const sessionId = getSessionId(ctx);
  if (sessionId === undefined) return false;

  let enabled = false;
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "custom" || entry.customType !== YOLO_MODE_ENTRY_TYPE) continue;
    if (isRecord(entry.data) === false || entry.data.sessionId !== sessionId) continue;
    if (typeof entry.data.enabled !== "boolean") continue;
    enabled = entry.data.enabled;
  }
  return enabled;
}

export function isYoloModeEnabled(ctx?: Pick<ExtensionContext, "sessionManager">): boolean {
  return ctx === undefined ? false : restoreYoloMode(ctx);
}

function setYoloStatus(ctx: Pick<ExtensionContext, "ui">, enabled: boolean): void {
  ctx.ui.setStatus(
    PERMISSION_SYSTEM_STATUS_KEY,
    enabled ? ctx.ui.theme.fg("error", YOLO_STATUS_TEXT) : undefined,
  );
}

function readySessionId(value: unknown): string | undefined {
  if (isRecord(value) === false || typeof value.sessionId !== "string") return undefined;
  return value.sessionId;
}

async function registerSessionYoloAuthorizer(
  sessionId: string,
  enabled: () => boolean,
): Promise<() => void> {
  const serviceModule = (await import(
    PERMISSION_SERVICE_MODULE_URL
  )) as PermissionSystemServiceModule;
  const permissions = serviceModule.getPermissionsService(sessionId);
  if (permissions === undefined) {
    throw new Error(`Permission service is unavailable for session '${sessionId}'.`);
  }

  return permissions.registerAuthorizer(SESSION_YOLO_AUTHORIZER, async () =>
    enabled() ? { kind: "allow" } : { kind: "defer" },
  );
}

export function registerYoloCommand(pi: ExtensionAPI): void {
  let enabled = false;
  let activeContext: ExtensionContext | undefined;
  let disposeAuthorizer: (() => void) | undefined;
  let registrationInFlight = false;
  let lifecycleGeneration = 0;

  pi.on("session_start", (_event, ctx) => {
    lifecycleGeneration += 1;
    registrationInFlight = false;
    activeContext = ctx;
    enabled = isYoloModeEnabled(ctx);
    setYoloStatus(ctx, enabled);
  });

  pi.events.on(PERMISSIONS_READY_CHANNEL, (value: unknown) => {
    const sessionId = readySessionId(value);
    const activeSessionId = activeContext === undefined ? undefined : getSessionId(activeContext);
    if (sessionId === undefined || sessionId !== activeSessionId) return;

    // The permission package refreshes its plain status during session_start;
    // republish ours after its lifecycle event and register the session link.
    if (activeContext !== undefined) setYoloStatus(activeContext, enabled);
    if (disposeAuthorizer !== undefined || registrationInFlight) return;

    const generation = lifecycleGeneration;
    registrationInFlight = true;
    void registerSessionYoloAuthorizer(sessionId, () => enabled)
      .then((dispose) => {
        if (generation !== lifecycleGeneration) {
          dispose();
          return;
        }
        disposeAuthorizer = dispose;
      })
      .catch((error: unknown) => {
        if (generation === lifecycleGeneration) {
          activeContext?.ui.notify(
            `Could not register session YOLO authorization: ${error instanceof Error ? error.message : String(error)}`,
            "error",
          );
        }
      })
      .finally(() => {
        if (generation === lifecycleGeneration) registrationInFlight = false;
      });
  });

  pi.on("session_shutdown", () => {
    lifecycleGeneration += 1;
    registrationInFlight = false;
    disposeAuthorizer?.();
    disposeAuthorizer = undefined;
    activeContext = undefined;
    enabled = false;
  });

  pi.registerCommand("yolo", {
    description: "Toggle YOLO mode for the current session",
    handler: async (args, ctx) => {
      if (args.trim() !== "") {
        ctx.ui.notify("Usage: /yolo", "warning");
        return;
      }

      try {
        const sessionId = getSessionId(ctx);
        if (sessionId === undefined) {
          ctx.ui.notify("Cannot toggle YOLO without an active session.", "error");
          return;
        }

        const nextEnabled = !enabled;
        pi.appendEntry<PersistedYoloMode>(YOLO_MODE_ENTRY_TYPE, {
          sessionId,
          enabled: nextEnabled,
        });
        enabled = nextEnabled;
        setYoloStatus(ctx, enabled);
        ctx.ui.notify(
          enabled
            ? "Session YOLO mode enabled. Ask-state permission checks and MCP tool approvals are auto-approved. Explicit denies still block."
            : "Session YOLO mode disabled. Ask-state permission checks and MCP tool approvals prompt when required.",
          enabled ? "warning" : "info",
        );
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}

export default function yoloMode(pi: ExtensionAPI): void {
  registerYoloCommand(pi);
}
