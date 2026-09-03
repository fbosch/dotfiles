import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
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
  await writeFile(
    join(agentDir, "auth-profiles", "personal.json"),
    '{"openai-codex":{"accountId":"personal-account"}}\n',
  );
  await writeFile(
    join(agentDir, "auth-profiles", "work.json"),
    '{"openai-codex":{"accountId":"work-account"}}\n',
  );
  process.env.PI_CODING_AGENT_DIR = agentDir;
  return { agentDir, cachePath: join(root, "cache.json") };
}

function cachedCredits(entries: Array<[string, number]>): string {
  const accounts = Object.fromEntries(
    entries.map(([accountId, availableCount]) => {
      const credentialKey = createHash("sha256")
        .update("openai-codex")
        .update("\0")
        .update(accountId)
        .digest("hex");
      return [
        credentialKey,
        {
          credentialKey,
          resetCredits: { availableCount, urgency: "soon" },
          resetCreditsCheckedAt: now,
        },
      ];
    }),
  );
  return JSON.stringify({
    schema: "fbb.pi-auth-profiles-usage-cache/v2",
    accounts,
  });
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

type InlineQuestionFactory = (
  tui: { requestRender(): void },
  theme: { fg(color: string, text: string): string },
  keybindings: {
    matches(data: string, binding: string): boolean;
    getKeys(binding: string): string[];
  },
  done: (value: unknown) => void,
) => Component;

function commandHarness(selections: string[], confirmation?: string, onQuestion?: () => void) {
  let handler: ((args: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined;
  const notifications: string[] = [];
  const questionRenders: string[][] = [];
  let popupSelectCalls = 0;
  let popupInputCalls = 0;
  const pi = {
    registerCommand: (_name: string, command: { handler: typeof handler }) => {
      handler = command.handler;
    },
  } as unknown as ExtensionAPI;
  const ctx = {
    hasUI: true,
    mode: "tui",
    isIdle: () => true,
    ui: {
      custom: async (factory: InlineQuestionFactory, options: { overlay?: boolean }) => {
        expect(options).toEqual({ overlay: false });
        const target = selections.shift() ?? confirmation;
        onQuestion?.();
        return new Promise((resolve) => {
          const component = factory(
            { requestRender: () => undefined },
            { fg: (_color, text) => text },
            {
              matches: (data, binding) =>
                binding === "tui.select.up"
                  ? data === "up" || data === "ctrl+k"
                  : binding === "tui.select.down"
                    ? data === "down" || data === "ctrl+j"
                    : binding === "tui.select.confirm"
                      ? data === "enter" || data === "\\r"
                      : data === "escape",
              getKeys: (binding) =>
                binding === "tui.select.up"
                  ? ["up"]
                  : binding === "tui.select.down"
                    ? ["down"]
                    : binding === "tui.select.confirm"
                      ? ["enter"]
                      : ["escape"],
            },
            resolve,
          );
          const rendered = () => component.render(200).join("\n");
          questionRenders.push(component.render(200));
          if (rendered().includes("Answer:")) {
            for (const character of target ?? "") component.handleInput?.(character);
            component.handleInput?.("\r");
            return;
          }
          for (let attempt = 0; attempt < 10; attempt += 1) {
            const current = rendered();
            const targetIsHighlighted =
              target !== undefined &&
              current.split("\n").some((line) => line.includes(target) && line.includes("▶"));
            if (targetIsHighlighted) {
              component.handleInput?.("enter");
              return;
            }
            component.handleInput?.("down");
          }
          component.handleInput?.("escape");
        });
      },
      select: async () => {
        popupSelectCalls += 1;
        return undefined;
      },
      input: async () => {
        popupInputCalls += 1;
        return undefined;
      },
      notify: (message: string) => notifications.push(message),
    },
  } as unknown as ExtensionCommandContext;
  return {
    pi,
    ctx,
    getHandler: () => handler,
    notifications,
    questionRenders,
    getPopupSelectCalls: () => popupSelectCalls,
    getPopupInputCalls: () => popupInputCalls,
  };
}

describe("/reset-credit", () => {
  test("dry-run previews a selected profile and confirms without consuming", async () => {
    const { cachePath } = await setupProfiles();
    await writeFile(
      cachePath,
      cachedCredits([
        ["personal-account", 0],
        ["work-account", 1],
      ]),
    );
    let questionShown = false;
    const requests: string[] = [];
    const fetchFn = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      requests.push(String(input));
      expect(questionShown).toBe(true);
      const token = new Headers(init?.headers).get("authorization");
      if (token?.startsWith("Bearer personal-")) return resetCredits(0, "unused", "Unused");
      return resetCredits(1, "opaque-work-credit", "Work reset");
    };
    const harness = commandHarness(
      ["work (1 cached)", "Work reset (expires in 6h)"],
      "CONSUME",
      () => {
        questionShown = true;
      },
    );
    registerResetCreditCommand(harness.pi, {
      cachePath,
      fetchFn,
      now: () => now,
      resolveCredential: async (profile) => {
        expect(questionShown).toBe(true);
        return {
          accessToken: `${profile}-access`,
          accountId: `${profile}-account`,
        };
      },
    });

    await harness.getHandler()?.("--dry-run", harness.ctx);

    expect(requests).toHaveLength(2);
    expect(requests.some((request) => request.endsWith("/consume"))).toBe(false);
    expect(questionShown).toBe(true);
    expect(harness.questionRenders[0]?.join("\n")).toContain("work (1 cached)");
    expect(harness.questionRenders[0]?.join("\n")).not.toContain("default");
    expect(harness.getPopupSelectCalls()).toBe(0);
    expect(harness.getPopupInputCalls()).toBe(0);
    expect(harness.questionRenders[2]?.join("\n")).toContain("Type CONSUME");
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
    const fetchFn = async (_input: string | URL, init?: RequestInit): Promise<Response> => {
      const token = new Headers(init?.headers).get("authorization");
      if (token?.startsWith("Bearer work-")) {
        workRequests += 1;
        if (workRequests === 1) return new Response(null, { status: 401 });
      }
      if (token?.startsWith("Bearer personal-")) return resetCredits(0, "unused", "Unused");
      return resetCredits(1, "opaque-work-credit", "Work reset");
    };
    const harness = commandHarness(
      ["work (availability unknown)", "Work reset (expires in 6h)"],
      "CONSUME",
    );
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
    expect(workRequests).toBe(3);
    expect(harness.getPopupInputCalls()).toBe(0);
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
    const harness = commandHarness(
      ["work (availability unknown)", "Work reset (expires in 6h)"],
      "CONSUME",
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

    const consumeRequests = requests.filter((request) => request.url.endsWith("/consume"));
    expect(consumeRequests).toHaveLength(1);
    expect(JSON.parse(consumeRequests[0]?.body ?? "{}")).toEqual({
      credit_id: "opaque-work-credit",
      redeem_request_id: expect.any(String),
    });
    expect(harness.getPopupSelectCalls()).toBe(0);
    expect(harness.getPopupInputCalls()).toBe(0);
    expect(harness.questionRenders[2]?.join("\n")).toContain("Type CONSUME");
    expect(harness.notifications.at(-1)).toBe(
      "Reset credit consumed for work; 2 usage windows reset.",
    );
    expect(await Bun.file(cachePath).exists()).toBe(false);
  });

  test("rejects malformed reset-credit responses without mutating anything", async () => {
    const { cachePath } = await setupProfiles();
    const fetchFn = async (): Promise<Response> => Response.json({ available_count: "1" });
    const harness = commandHarness(["personal (availability unknown)"]);
    registerResetCreditCommand(harness.pi, {
      cachePath,
      fetchFn,
      resolveCredential: async (profile) => ({
        accessToken: `${profile}-access`,
        accountId: `${profile}-account`,
      }),
    });

    await harness.getHandler()?.("", harness.ctx);

    expect(harness.getPopupSelectCalls()).toBe(0);
    expect(harness.getPopupInputCalls()).toBe(0);
    expect(harness.notifications[0]).toBe("reset credit response has an unexpected shape");
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
      ["personal (availability unknown)", "Work reset (expires in 6h)"],
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
    expect(harness.getPopupSelectCalls()).toBe(0);
    expect(harness.getPopupInputCalls()).toBe(0);
    expect(harness.notifications.at(-1)).toBe("Cancelled: no reset credit was consumed.");
  });
});
