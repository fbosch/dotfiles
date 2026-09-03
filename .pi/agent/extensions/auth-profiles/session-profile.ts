import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { normalizeName } from "./profile-store";

const SESSION_PROFILE_ENTRY_TYPE = "auth-profile-override";

type PersistedSessionProfile = {
  sessionId: string;
  profile: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function sessionId(ctx: Pick<ExtensionContext, "sessionManager">): string | undefined {
  return ctx.sessionManager.getHeader()?.id;
}

export function restoreSessionProfile(
  ctx: Pick<ExtensionContext, "sessionManager">,
): string | undefined {
  const activeSessionId = sessionId(ctx);
  if (activeSessionId === undefined) return undefined;

  let profile: string | undefined;
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "custom" || entry.customType !== SESSION_PROFILE_ENTRY_TYPE) continue;
    if (isRecord(entry.data) === false || entry.data.sessionId !== activeSessionId) continue;
    if (entry.data.profile === null) {
      profile = undefined;
      continue;
    }
    if (typeof entry.data.profile !== "string") continue;
    try {
      profile = normalizeName(entry.data.profile);
    } catch {
      // Ignore malformed session state instead of preventing automatic selection.
    }
  }
  return profile;
}

export function persistSessionProfile(
  pi: Pick<ExtensionAPI, "appendEntry">,
  ctx: Pick<ExtensionContext, "sessionManager">,
  profile: string | undefined,
): void {
  const activeSessionId = sessionId(ctx);
  if (activeSessionId === undefined) {
    throw new Error("Cannot change the auth profile without an active session.");
  }

  pi.appendEntry<PersistedSessionProfile>(SESSION_PROFILE_ENTRY_TYPE, {
    sessionId: activeSessionId,
    profile: profile ?? null,
  });
}
