import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface QuickReplyModel {
  provider: string;
  id: string;
}

export const DEFAULT_QUICK_REPLY_MODEL = "openai-codex/gpt-5.6-luna-fast";

export function resolveQuickReplyModel(
  context: Pick<ExtensionContext, "cwd" | "isProjectTrusted">,
): QuickReplyModel | undefined {
  let reference = DEFAULT_QUICK_REPLY_MODEL;

  if (context.isProjectTrusted()) {
    try {
      const settings: unknown = JSON.parse(
        readFileSync(join(context.cwd, ".pi", "settings.json"), "utf8"),
      );
      if (isRecord(settings) && settings.quickReplies !== undefined) {
        if (isRecord(settings.quickReplies) === false) return undefined;
        if (typeof settings.quickReplies.model !== "string") return undefined;
        reference = settings.quickReplies.model.trim();
      }
    } catch (error) {
      if (isMissingFile(error) === false) return undefined;
    }
  }

  const separator = reference.indexOf("/");
  if (separator <= 0 || separator === reference.length - 1) return undefined;
  return { provider: reference.slice(0, separator), id: reference.slice(separator + 1) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
