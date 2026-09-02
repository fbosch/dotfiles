import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_PROFILE,
  listProfiles,
  normalizeName,
  publishWezTermChange,
} from "./profile-store";

const RESET_CREDITS_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const USAGE_CACHE_PATH = "pi-auth-profiles-usage.json";
const USAGE_CACHE_DIR = "fbb";

type FetchFn = (input: string | URL, init?: RequestInit) => Promise<Response>;

type ResetCredential = {
  accessToken: string;
  accountId: string;
};

type ResetCredit = {
  id: string;
  title: string | null;
  resetType: string | null;
  status: string;
  expiresAt: string | null;
};

type ResetCredits = {
  availableCount: number;
  credits: ResetCredit[];
};

type ResolveCredential = (
  profile: string,
  ctx: ExtensionCommandContext,
) => Promise<ResetCredential>;

type ResetCreditCommandOptions = {
  resolveCredential: ResolveCredential;
  fetchFn?: FetchFn;
  now?: () => number;
  cachePath?: string;
};

type CommandOptions = {
  dryRun: boolean;
};

class CommandInputError extends Error {}

class ResetCreditRequestError extends Error {
  constructor(readonly status: number) {
    super(`reset credit request failed with ${status}`);
  }
}

function parseCommandOptions(args: string): CommandOptions {
  const tokens = args.trim() ? args.trim().split(/\s+/) : [];
  let dryRun = false;
  for (const token of tokens) {
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    throw new CommandInputError("Usage: /reset-credit [--dry-run]");
  }
  return { dryRun };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, maxLength) : null;
}

function validDate(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

function parseResetCredits(payload: unknown): ResetCredits {
  if (!isRecord(payload) || !Number.isInteger(payload.available_count)) {
    throw new Error("reset credit response has an unexpected shape");
  }
  const availableCount = payload.available_count;
  if (typeof availableCount !== "number" || availableCount < 0) {
    throw new Error("reset credit response has an unexpected shape");
  }

  const credits = Array.isArray(payload.credits)
    ? payload.credits.flatMap((value): ResetCredit[] => {
        if (!isRecord(value)) return [];
        const id =
          typeof value.id === "string" && value.id.length > 0 && value.id.length <= 512
            ? value.id
            : undefined;
        if (id === undefined) return [];
        return [
          {
            id,
            title: boundedText(value.title, 120),
            resetType: boundedText(value.reset_type, 80),
            status: boundedText(value.status, 80) ?? "unknown",
            expiresAt: validDate(value.expires_at),
          },
        ];
      })
    : [];
  return { availableCount, credits };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error("response is too large");
  }
  if (!response.body) return undefined;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("response is too large");
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return JSON.parse(chunks.join(""));
}

async function requestResetCredits(
  credential: ResetCredential,
  fetchFn: FetchFn,
): Promise<ResetCredits> {
  const response = await fetchFn(RESET_CREDITS_URL, {
    headers: {
      Authorization: `Bearer ${credential.accessToken}`,
      "ChatGPT-Account-Id": credential.accountId,
    },
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new ResetCreditRequestError(response.status);
  }
  return parseResetCredits(await readBoundedJson(response));
}

async function requestProfileCredits(
  profile: string,
  ctx: ExtensionCommandContext,
  resolveCredential: ResolveCredential,
  fetchFn: FetchFn,
  credential?: ResetCredential,
): Promise<{ credential: ResetCredential; credits: ResetCredits }> {
  const initialCredential = credential ?? (await resolveCredential(profile, ctx));
  try {
    return {
      credential: initialCredential,
      credits: await requestResetCredits(initialCredential, fetchFn),
    };
  } catch (error) {
    if (!(error instanceof ResetCreditRequestError) || error.status !== 401) throw error;
    const refreshedCredential = await resolveCredential(profile, ctx);
    return {
      credential: refreshedCredential,
      credits: await requestResetCredits(refreshedCredential, fetchFn),
    };
  }
}

function durationUntil(expiresAt: string | null, now: number): string {
  if (!expiresAt) return "expiry unknown";
  const remaining = Date.parse(expiresAt) - now;
  if (!Number.isFinite(remaining)) return "expiry unknown";
  if (remaining <= 0) return "expired";
  if (remaining < 60 * 1_000) return `${Math.ceil(remaining / 1_000)}s`;
  if (remaining < 60 * 60 * 1_000) return `${Math.ceil(remaining / (60 * 1_000))}m`;
  if (remaining < 86_400 * 1_000) return `${Math.ceil(remaining / (60 * 60 * 1_000))}h`;
  return `${Math.ceil(remaining / (86_400 * 1_000))}d`;
}

function creditLabel(credit: ResetCredit, now: number): string {
  const name = credit.title ?? credit.resetType ?? "Reset credit";
  return `${name} (expires in ${durationUntil(credit.expiresAt, now)})`;
}

function profileLabel(profile: string, credits: ResetCredits): string {
  return `${profile} (${credits.credits.filter((credit) => credit.status === "available").length} available)`;
}

function usageCachePath(): string {
  const cacheHome = process.env.XDG_CACHE_HOME || `${homedir()}/.cache`;
  return join(cacheHome, USAGE_CACHE_DIR, USAGE_CACHE_PATH);
}

function invalidateUsageCache(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // A stale status snapshot is harmless; the reset response remains authoritative.
  }
}

async function consumeResetCredit(
  credential: ResetCredential,
  creditId: string,
  fetchFn: FetchFn,
): Promise<{ code: string | null; windowsReset: number | null }> {
  const response = await fetchFn(`${RESET_CREDITS_URL}/consume`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credential.accessToken}`,
      "ChatGPT-Account-Id": credential.accountId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      credit_id: creditId,
      redeem_request_id: randomUUID(),
    }),
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`reset credit consume request failed with ${response.status}`);
  }
  const payload = await readBoundedJson(response);
  if (!isRecord(payload)) {
    throw new Error("reset credit consume response has an unexpected shape");
  }
  const code = boundedText(payload.code, 80);
  const windowsReset =
    typeof payload.windows_reset === "number" && Number.isFinite(payload.windows_reset)
      ? payload.windows_reset
      : null;
  return { code, windowsReset };
}

function availableCredits(data: ResetCredits): ResetCredit[] {
  return data.credits.filter((credit) => credit.status === "available");
}

function summarizeErrors(errors: string[]): string {
  if (errors.length === 0) return "";
  return `\nUnavailable profiles: ${errors.join(", ")}.`;
}

async function chooseProfile(
  profiles: string[],
  ctx: ExtensionCommandContext,
  resolveCredential: ResolveCredential,
  fetchFn: FetchFn,
): Promise<{ profile: string; credential: ResetCredential; credits: ResetCredits } | undefined> {
  const available: Array<{ profile: string; credential: ResetCredential; credits: ResetCredits }> =
    [];
  const errors: string[] = [];
  for (const profile of profiles) {
    try {
      const result = await requestProfileCredits(profile, ctx, resolveCredential, fetchFn);
      if (availableCredits(result.credits).length > 0) {
        available.push({ profile, ...result });
      }
    } catch {
      errors.push(profile);
    }
  }

  if (available.length === 0) {
    ctx.ui.notify(
      `No named Pi profiles have an available reset credit.${summarizeErrors(errors)}`,
      "warning",
    );
    return undefined;
  }

  const selected = await ctx.ui.select(
    "Select a Pi auth profile",
    available.map(({ profile, credits }) => profileLabel(profile, credits)),
  );
  if (selected === undefined) return undefined;
  const index = available.findIndex(
    ({ profile, credits }) => selected === profileLabel(profile, credits),
  );
  return index === -1 ? undefined : available[index];
}

export function registerResetCreditCommand(
  pi: ExtensionAPI,
  options: ResetCreditCommandOptions,
): void {
  pi.registerCommand("reset-credit", {
    description: "Select and consume a Pi auth-profile reset credit",
    handler: async (args, ctx) => {
      if (ctx.hasUI === false) {
        ctx.ui.notify("/reset-credit requires Pi's interactive UI.", "error");
        return;
      }
      if (ctx.isIdle() === false) {
        ctx.ui.notify(
          "Wait for the current response to finish before consuming a reset credit.",
          "warning",
        );
        return;
      }

      let commandOptions: CommandOptions;
      try {
        commandOptions = parseCommandOptions(args);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
        return;
      }

      const profiles = listProfiles().filter((profile) => {
        if (profile === DEFAULT_PROFILE) return false;
        try {
          normalizeName(profile);
          return true;
        } catch {
          return false;
        }
      });
      if (profiles.length === 0) {
        ctx.ui.notify("No named Pi auth profiles are configured.", "warning");
        return;
      }

      const fetchFn = options.fetchFn ?? fetch;
      try {
        const selected = await chooseProfile(profiles, ctx, options.resolveCredential, fetchFn);
        if (!selected) return;

        const fresh = await requestProfileCredits(
          selected.profile,
          ctx,
          options.resolveCredential,
          fetchFn,
          selected.credential,
        );
        let selectedCredential = fresh.credential;
        const credits = availableCredits(fresh.credits);
        if (credits.length === 0) {
          ctx.ui.notify(`No reset credits remain for profile ${selected.profile}.`, "warning");
          return;
        }
        const now = (options.now ?? Date.now)();
        const creditSelection = await ctx.ui.select(
          `Select a reset credit for ${selected.profile}`,
          credits.map((credit) => creditLabel(credit, now)),
        );
        if (creditSelection === undefined) return;
        const creditIndex = credits.findIndex(
          (credit) => creditLabel(credit, now) === creditSelection,
        );
        const credit = credits[creditIndex];
        if (!credit) return;

        const preview =
          `Profile: ${selected.profile}\n` +
          `Credit: ${creditLabel(credit, now)}\n` +
          "Effect: reset the account's current usage windows.";
        ctx.ui.notify(preview, commandOptions.dryRun ? "info" : "warning");
        if (commandOptions.dryRun) {
          ctx.ui.notify("Dry run: no reset credit was consumed.", "info");
          return;
        }

        const confirmation = await ctx.ui.input(
          `Type CONSUME to consume the selected credit for ${selected.profile}`,
          "CONSUME",
        );
        if (confirmation !== "CONSUME") {
          ctx.ui.notify("Cancelled: no reset credit was consumed.", "info");
          return;
        }

        const final = await requestProfileCredits(
          selected.profile,
          ctx,
          options.resolveCredential,
          fetchFn,
          selectedCredential,
        );
        selectedCredential = final.credential;
        const stillAvailable = final.credits.credits.find(
          (candidate) => candidate.id === credit.id && candidate.status === "available",
        );
        if (!stillAvailable) {
          ctx.ui.notify(
            "That reset credit is no longer available; nothing was consumed.",
            "warning",
          );
          return;
        }

        let result: { code: string | null; windowsReset: number | null };
        try {
          result = await consumeResetCredit(selectedCredential, credit.id, fetchFn);
        } catch (error) {
          ctx.ui.notify(
            `${error instanceof Error ? error.message : String(error)}\nConsumption may have reached the server; inspect /reset-credit before retrying.`,
            "error",
          );
          return;
        }
        invalidateUsageCache(options.cachePath ?? usageCachePath());
        publishWezTermChange(ctx, "usage", String(Date.now()));
        const resetDescription =
          result.windowsReset === null
            ? "usage windows refreshed"
            : `${result.windowsReset} usage windows reset`;
        ctx.ui.notify(
          `Reset credit consumed for ${selected.profile}; ${resetDescription}.`,
          "info",
        );
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}

export const _test = {
  parseResetCredits,
  parseCommandOptions,
  durationUntil,
};
