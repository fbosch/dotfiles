import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const YOLO_STATUS_KEY = "session-yolo";
export const YOLO_STATUS_TEXT = "󱚝 yolo";
export const YOLO_EFFECTIVE_STATE_CHANNEL = "pi-yolo:effective-state";

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

export interface YoloEffectiveStateEvent {
  sessionId: string;
  effectiveEnabled: boolean;
}

interface PersistedYoloMode {
  sessionId: string;
  enabled: boolean;
}

type SessionYoloRegistrationState = "not_ready" | "registering" | "registered" | "failed";
type SessionYoloVerdict = { kind: "allow" } | { kind: "defer" };
type SessionYoloAuthorizer = (...args: never[]) => Promise<SessionYoloVerdict>;

interface SessionYoloPermissions {
  registerAuthorizer(name: string, authorize: SessionYoloAuthorizer): () => void;
}

interface PermissionSystemServiceModule {
  getPermissionsService(sessionId: string): SessionYoloPermissions | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function getSessionId(ctx: Pick<ExtensionContext, "sessionManager">): string | undefined {
  return ctx.sessionManager.getHeader()?.id;
}

function restoreRequestedYoloMode(ctx: Pick<ExtensionContext, "sessionManager">): boolean {
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

export function isYoloEffectiveStateEvent(value: unknown): value is YoloEffectiveStateEvent {
  return (
    isRecord(value) &&
    typeof value.sessionId === "string" &&
    value.sessionId.length > 0 &&
    typeof value.effectiveEnabled === "boolean"
  );
}

function setYoloStatus(ctx: Pick<ExtensionContext, "ui">, enabled: boolean): void {
  ctx.ui.setStatus(
    YOLO_STATUS_KEY,
    enabled ? ctx.ui.theme.fg("error", YOLO_STATUS_TEXT) : undefined,
  );
}

function publishEffectiveYoloState(
  pi: ExtensionAPI,
  ctx: Pick<ExtensionContext, "sessionManager" | "ui">,
  effectiveEnabled: boolean,
): void {
  const sessionId = getSessionId(ctx);
  if (sessionId !== undefined) {
    pi.events.emit(YOLO_EFFECTIVE_STATE_CHANNEL, { sessionId, effectiveEnabled });
  }
  setYoloStatus(ctx, effectiveEnabled);
}

function readySessionId(value: unknown): string | undefined {
  if (isRecord(value) === false || typeof value.sessionId !== "string") return undefined;
  return value.sessionId.length > 0 ? value.sessionId : undefined;
}

async function registerSessionYoloAuthorizer(
  sessionId: string,
  effectiveEnabled: () => boolean,
): Promise<() => void> {
  const serviceModule = (await import(
    PERMISSION_SERVICE_MODULE_URL
  )) as PermissionSystemServiceModule;
  const permissions = serviceModule.getPermissionsService(sessionId);
  if (permissions === undefined) {
    throw new Error(`Permission service is unavailable for session '${sessionId}'.`);
  }

  return permissions.registerAuthorizer(SESSION_YOLO_AUTHORIZER, async () =>
    effectiveEnabled() ? { kind: "allow" } : { kind: "defer" },
  );
}

function unavailableEnableMessage(registrationState: SessionYoloRegistrationState): string {
  if (registrationState === "registering") {
    return "Cannot enable session YOLO while permission-system registration is pending.";
  }
  if (registrationState === "failed") {
    return "Cannot enable session YOLO because permission-system registration failed.";
  }
  return "Cannot enable session YOLO before permission-system is ready.";
}

export function registerYoloCommand(pi: ExtensionAPI): void {
  let requestedEnabled = false;
  let registrationState: SessionYoloRegistrationState = "not_ready";
  let activeContext: ExtensionContext | undefined;
  let activeSessionId: string | undefined;
  let disposeAuthorizer: (() => void) | undefined;
  let lifecycleGeneration = 0;

  const isEffective = () => registrationState === "registered" && requestedEnabled;

  pi.on("session_start", (_event, ctx) => {
    lifecycleGeneration += 1;
    registrationState = "not_ready";
    if (activeContext !== undefined) publishEffectiveYoloState(pi, activeContext, false);
    disposeAuthorizer?.();
    disposeAuthorizer = undefined;

    activeContext = ctx;
    activeSessionId = getSessionId(ctx);
    requestedEnabled = restoreRequestedYoloMode(ctx);
    publishEffectiveYoloState(pi, ctx, false);
  });

  const disposeReadyListener = pi.events.on(PERMISSIONS_READY_CHANNEL, (value: unknown) => {
    const sessionId = readySessionId(value);
    if (sessionId === undefined || sessionId !== activeSessionId) return;
    if (registrationState === "registered" || registrationState === "registering") return;

    const generation = lifecycleGeneration;
    registrationState = "registering";
    if (activeContext !== undefined) publishEffectiveYoloState(pi, activeContext, false);

    void registerSessionYoloAuthorizer(sessionId, isEffective)
      .then((dispose) => {
        if (generation !== lifecycleGeneration || sessionId !== activeSessionId) {
          dispose();
          return;
        }
        disposeAuthorizer = dispose;
        registrationState = "registered";
        if (activeContext !== undefined) {
          publishEffectiveYoloState(pi, activeContext, isEffective());
        }
      })
      .catch((error: unknown) => {
        if (generation !== lifecycleGeneration || sessionId !== activeSessionId) return;
        registrationState = "failed";
        if (activeContext !== undefined) publishEffectiveYoloState(pi, activeContext, false);
        activeContext?.ui.notify(
          `Could not register session YOLO authorization: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      });
  });

  pi.on("session_shutdown", () => {
    lifecycleGeneration += 1;
    registrationState = "not_ready";
    if (activeContext !== undefined) publishEffectiveYoloState(pi, activeContext, false);
    disposeAuthorizer?.();
    disposeAuthorizer = undefined;
    disposeReadyListener();
    activeContext = undefined;
    activeSessionId = undefined;
    requestedEnabled = false;
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
        if (sessionId === undefined || sessionId !== activeSessionId) {
          ctx.ui.notify("Cannot toggle YOLO without the active session.", "error");
          return;
        }

        const nextRequestedEnabled = !requestedEnabled;
        if (nextRequestedEnabled && registrationState !== "registered") {
          ctx.ui.notify(unavailableEnableMessage(registrationState), "error");
          return;
        }

        pi.appendEntry<PersistedYoloMode>(YOLO_MODE_ENTRY_TYPE, {
          sessionId,
          enabled: nextRequestedEnabled,
        });
        requestedEnabled = nextRequestedEnabled;
        publishEffectiveYoloState(pi, ctx, isEffective());
        ctx.ui.notify(
          requestedEnabled
            ? "Session YOLO mode enabled. Ordinary ask-state permission checks and MCP tool approvals are auto-approved. Path-sensitive asks and explicit denies still block."
            : "Session YOLO mode disabled. Permission checks and MCP tool approvals prompt when required.",
          requestedEnabled ? "warning" : "info",
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
