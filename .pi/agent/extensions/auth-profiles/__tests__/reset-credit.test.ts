import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { registerResetCreditCommand } from "../reset-credit";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const temporaryDirectories: string[] = [];
const now = Date.parse("2026-09-02T10:00:00.000Z");

afterEach(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function setupProfiles(): Promise<{ agentDir: string; cachePath: string }> {
  const root = await mkdtemp(join(tmpdir(), "pi-reset-credit-"));
  temporaryDirectories.push(root);
  const agentDir = join(root, "agent");
  await mkdir(join(agentDir, "auth-profiles"), { recursive: true });
  await writeFile(join(agentDir, "auth-profiles", "personal.json"), "{}\n");
  await writeFile(join(agentDir, "auth-profiles", "work.json"), "{}\n");
  process.env.PI_CODING_AGENT_DIR = agentDir;
  return { agentDir, cachePath: join(root, "cache.json") };
}

function resetCredits(availableCount: number, id: string, title: string): Response {
  return Response.json({
    available_count: availableCount,
    credits: availableCount
      ? [
          {
            id,
            status: "available",
            title,
            reset_type: "earned",
            expires_at: "2026-09-02T16:00:00Z",
          },
        ]
      : [],
  });
}

function commandHarness(selections: string[], confirmation?: string) {
  let handler: ((args: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined;
  const notifications: string[] = [];
  const inputTitles: string[] = [];
  const selectOptions: string[][] = [];
  let inputCalls = 0;
  const pi = {
    registerCommand: (_name: string, command: { handler: typeof handler }) => {
      handler = command.handler;
    },
  } as unknown as ExtensionAPI;
  const ctx = {
    hasUI: true,
    isIdle: () => true,
    ui: {
      select: async (_title: string, options: string[]) => {
        selectOptions.push(options);
        return selections.shift();
      },
      input: async (title: string) => {
        inputCalls += 1;
        inputTitles.push(title);
        return confirmation;
      },
      notify: (message: string) => notifications.push(message),
    },
  } as unknown as ExtensionCommandContext;
  return {
    pi,
    ctx,
    getHandler: () => handler,
    notifications,
    inputTitles,
    selectOptions,
    getInputCalls: () => inputCalls,
  };
}

describe("/reset-credit", () => {
  test("dry-run previews a selected profile and credit without prompting or consuming", async () => {
    const { cachePath } = await setupProfiles();
    const requests: string[] = [];
    const fetchFn = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      requests.push(String(input));
      const token = new Headers(init?.headers).get("authorization");
      if (token?.startsWith("Bearer personal-")) return resetCredits(0, "unused", "Unused");
      return resetCredits(1, "opaque-work-credit", "Work reset");
    };
    const harness = commandHarness(["work (1 available)", "Work reset (expires in 6h)"]);
    registerResetCreditCommand(harness.pi, {
      cachePath,
      fetchFn,
      now: () => now,
      resolveCredential: async (profile) => ({
        accessToken: `${profile}-access`,
        accountId: `${profile}-account`,
      }),
    });

    await harness.getHandler()?.("--dry-run", harness.ctx);

    expect(requests).toHaveLength(3);
    expect(harness.selectOptions[0]).toEqual(["work (1 available)"]);
    expect(harness.selectOptions[0]).not.toContain("default");
    expect(harness.getInputCalls()).toBe(0);
    expect(harness.notifications).toEqual([
      "Profile: work\nCredit: Work reset (expires in 6h)\nEffect: reset the account's current usage windows.",
      "Dry run: no reset credit was consumed.",
    ]);
    expect(harness.notifications.join("\n")).not.toContain("opaque-work-credit");
  });

  test("re-resolves a profile once after a 401 on a read-only request", async () => {
    await setupProfiles();
    let workCredentialResolutions = 0;
    let workRequests = 0;
    const fetchFn = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const token = new Headers(init?.headers).get("authorization");
      if (token?.startsWith("Bearer work-")) {
        workRequests += 1;
        if (workRequests === 1) return new Response(null, { status: 401 });
      }
      if (token?.startsWith("Bearer personal-")) return resetCredits(0, "unused", "Unused");
      return resetCredits(1, "opaque-work-credit", "Work reset");
    };
    const harness = commandHarness(["work (1 available)", "Work reset (expires in 6h)"]);
    registerResetCreditCommand(harness.pi, {
      fetchFn,
      now: () => now,
      resolveCredential: async (profile) => {
        if (profile === "work") workCredentialResolutions += 1;
        return { accessToken: `${profile}-access`, accountId: `${profile}-account` };
      },
    });

    await harness.getHandler()?.("--dry-run", harness.ctx);

    expect(workCredentialResolutions).toBe(2);
    expect(workRequests).toBe(2);
    expect(harness.getInputCalls()).toBe(0);
  });

  test("revalidates and consumes only after exact CONSUME confirmation", async () => {
    const { cachePath } = await setupProfiles();
    await writeFile(cachePath, "stale usage snapshot\n");
    const requests: Array<{ url: string; method: string | undefined; body: string | undefined }> =
      [];
    const fetchFn = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      requests.push({ url: String(input), method: init?.method, body: init?.body?.toString() });
      if (String(input).endsWith("/consume")) {
        return Response.json({ code: "redeemed", windows_reset: 2 });
      }
      const token = new Headers(init?.headers).get("authorization");
      if (token?.startsWith("Bearer personal-")) return resetCredits(0, "unused", "Unused");
      return resetCredits(1, "opaque-work-credit", "Work reset");
    };
    const harness = commandHarness(["work (1 available)", "Work reset (expires in 6h)"], "CONSUME");
    registerResetCreditCommand(harness.pi, {
      cachePath,
      fetchFn,
      now: () => now,
      resolveCredential: async (profile) => ({
        accessToken: `${profile}-access`,
        accountId: `${profile}-account`,
      }),
    });

    await harness.getHandler()?.("", harness.ctx);

    const consumeRequests = requests.filter((request) => request.url.endsWith("/consume"));
    expect(consumeRequests).toHaveLength(1);
    expect(JSON.parse(consumeRequests[0]?.body ?? "{}")).toEqual({
      credit_id: "opaque-work-credit",
      redeem_request_id: expect.any(String),
    });
    expect(harness.getInputCalls()).toBe(1);
    expect(harness.inputTitles[0]).toContain("Type CONSUME");
    expect(harness.notifications.at(-1)).toBe(
      "Reset credit consumed for work; 2 usage windows reset.",
    );
    expect(await Bun.file(cachePath).exists()).toBe(false);
  });

  test("rejects malformed reset-credit responses without mutating anything", async () => {
    const { cachePath } = await setupProfiles();
    let selectCalls = 0;
    const fetchFn = async (): Promise<Response> => Response.json({ available_count: "1" });
    const harness = commandHarness([]);
    const originalSelect = harness.ctx.ui.select;
    harness.ctx.ui.select = async (...args: Parameters<typeof originalSelect>) => {
      selectCalls += 1;
      return originalSelect(...args);
    };
    registerResetCreditCommand(harness.pi, {
      cachePath,
      fetchFn,
      resolveCredential: async (profile) => ({
        accessToken: `${profile}-access`,
        accountId: `${profile}-account`,
      }),
    });

    await harness.getHandler()?.("", harness.ctx);

    expect(selectCalls).toBe(0);
    expect(harness.notifications[0]).toBe(
      "No named Pi profiles have an available reset credit.\nUnavailable profiles: personal, work.",
    );
  });

  test("does not consume when confirmation is not exactly CONSUME", async () => {
    const { cachePath } = await setupProfiles();
    let consumed = false;
    const fetchFn = async (input: string | URL): Promise<Response> => {
      if (String(input).endsWith("/consume")) {
        consumed = true;
        return Response.json({});
      }
      return resetCredits(1, "opaque-work-credit", "Work reset");
    };
    const harness = commandHarness(
      ["personal (1 available)", "Work reset (expires in 6h)"],
      "consume",
    );
    registerResetCreditCommand(harness.pi, {
      cachePath,
      fetchFn,
      now: () => now,
      resolveCredential: async (profile) => ({
        accessToken: `${profile}-access`,
        accountId: `${profile}-account`,
      }),
    });

    await harness.getHandler()?.("", harness.ctx);

    expect(consumed).toBe(false);
    expect(harness.notifications.at(-1)).toBe("Cancelled: no reset credit was consumed.");
  });
});
