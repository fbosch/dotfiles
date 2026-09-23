import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import autoSessionTitle, {
  composeSessionTitle,
  extractTicketReferences,
  generateTitle,
} from "../index";

const temporaryDirectories: string[] = [];

type SessionStartHandler = (event: unknown, ctx: ExtensionContext) => void;
type BeforeAgentStartHandler = (
  event: BeforeAgentStartEvent,
  ctx: ExtensionContext,
) => Promise<unknown> | unknown;

describe("extractTicketReferences", () => {
  test("keeps hash and prefixed ticket references in source order", () => {
    expect(extractTicketReferences("Fix #290123 before AB#12903, then revisit #290123")).toEqual([
      "#290123",
      "AB#12903",
    ]);
  });

  test("does not extract the hash suffix from a prefixed reference twice", () => {
    expect(extractTicketReferences("Handle AB#12903")).toEqual(["AB#12903"]);
  });
});

describe("composeSessionTitle", () => {
  test("restores exact ticket references omitted by the model", () => {
    expect(
      composeSessionTitle("Repair session title generation", "Please fix AB#12903 and #290123"),
    ).toBe("AB#12903 #290123 Repair session title generation");
  });

  test("canonicalizes model output without duplicating references", () => {
    expect(composeSessionTitle('## Session title: "#290123 Fix the parser."', "Fix #290123")).toBe(
      "#290123 Fix the parser",
    );
  });

  test("keeps metadata when the title must be truncated", () => {
    const title = composeSessionTitle(
      "Implement a deliberately long description of the session title generation behavior and its safeguards",
      "Work on AB#12903",
    );

    expect(title?.startsWith("AB#12903 ")).toBe(true);
    expect(title?.length).toBeLessThanOrEqual(72);
  });

  test("can use a ticket reference as the entire title", () => {
    expect(composeSessionTitle("", "Investigate #290123")).toBe("#290123");
  });
});

describe("auto-session-title lifecycle", () => {
  test("registers handlers without reading skills during extension initialization", () => {
    const homeDirectory = mkdtempSync(join(tmpdir(), "auto-session-title-home-"));
    temporaryDirectories.push(homeDirectory);
    const modulePath = resolve(import.meta.dir, "../index.ts");
    const result = Bun.spawnSync(
      [
        process.execPath,
        "-e",
        `
          const { default: autoSessionTitle } = await import(${JSON.stringify(modulePath)});
          const events = [];
          await autoSessionTitle({ on(event) { events.push(event); } });
          console.log(events.join(","));
        `,
      ],
      {
        env: { ...process.env, HOME: homeDirectory },
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(result.stdout.toString().trim()).toBe("session_start,before_agent_start");
  });

  test("loads guidance on the first eligible request and caches it for the generation", async () => {
    const agentDirectory = mkdtempSync(join(tmpdir(), "auto-session-title-agent-"));
    temporaryDirectories.push(agentDirectory);
    writeFileSync(join(agentDirectory, "settings.json"), "{}");
    const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDirectory;

    try {
      let sessionName: string | undefined;
      let guidanceLoads = 0;
      const systemPrompts: string[] = [];
      let sessionStart: SessionStartHandler | undefined;
      let beforeAgentStart: BeforeAgentStartHandler | undefined;
      const pi = {
        getSessionName: () => sessionName,
        setSessionName: (name: string) => {
          sessionName = name;
        },
        on(event: string, handler: unknown) {
          if (event === "session_start") sessionStart = handler as SessionStartHandler;
          if (event === "before_agent_start") {
            beforeAgentStart = handler as BeforeAgentStartHandler;
          }
        },
      } as unknown as ExtensionAPI;
      const ctx = {
        hasUI: true,
        sessionManager: { getBranch: () => [] },
        ui: { notify: () => {} },
        modelRegistry: {
          find: () => ({}),
          complete: async (_model: unknown, request: { systemPrompt: string }) => {
            systemPrompts.push(request.systemPrompt);
            return {
              content: [{ type: "text", text: "Generated title" }],
              stopReason: "stop",
            };
          },
        },
      } as unknown as ExtensionContext;

      await autoSessionTitle(pi, async () => {
        guidanceLoads += 1;
        return `Guidance ${guidanceLoads}`;
      });
      expect(guidanceLoads).toBe(0);

      sessionStart?.({}, ctx);
      await beforeAgentStart?.({ prompt: "First request" } as BeforeAgentStartEvent, ctx);
      expect(guidanceLoads).toBe(1);

      sessionName = undefined;
      sessionStart?.({}, ctx);
      await beforeAgentStart?.({ prompt: "Second request" } as BeforeAgentStartEvent, ctx);

      expect(guidanceLoads).toBe(1);
      expect(systemPrompts).toHaveLength(2);
      expect(systemPrompts[0]).toContain("Guidance 1");
      expect(systemPrompts[1]).toBe(systemPrompts[0]);
    } finally {
      if (previousAgentDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
    }
  });

  test("reports guidance errors from the eligible handler", async () => {
    const agentDirectory = mkdtempSync(join(tmpdir(), "auto-session-title-agent-"));
    temporaryDirectories.push(agentDirectory);
    writeFileSync(join(agentDirectory, "settings.json"), "{}");
    const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDirectory;

    try {
      const notifications: string[] = [];
      let sessionStart: SessionStartHandler | undefined;
      let beforeAgentStart: BeforeAgentStartHandler | undefined;
      const pi = {
        getSessionName: () => undefined,
        setSessionName: () => {},
        on(event: string, handler: unknown) {
          if (event === "session_start") sessionStart = handler as SessionStartHandler;
          if (event === "before_agent_start") {
            beforeAgentStart = handler as BeforeAgentStartHandler;
          }
        },
      } as unknown as ExtensionAPI;
      const ctx = {
        hasUI: true,
        sessionManager: { getBranch: () => [] },
        ui: { notify: (message: string) => notifications.push(message) },
        modelRegistry: { find: () => ({}) },
      } as unknown as ExtensionContext;

      await autoSessionTitle(pi, async () => {
        throw new Error("guidance unavailable");
      });
      sessionStart?.({}, ctx);
      await beforeAgentStart?.({ prompt: "First request" } as BeforeAgentStartEvent, ctx);
      await beforeAgentStart?.({ prompt: "Second request" } as BeforeAgentStartEvent, ctx);

      expect(notifications).toEqual(["Could not generate a session title: guidance unavailable"]);
    } finally {
      if (previousAgentDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
    }
  });
});

describe("generateTitle", () => {
  test("uses configured model and low reasoning without changing the active model", async () => {
    const model = {
      provider: "openai-codex",
      id: "gpt-6-luna-fast",
      api: "openai-codex-responses",
    };
    const calls: Array<{ model: unknown; options: unknown }> = [];
    const ctx = {
      modelRegistry: {
        find: (provider: string, id: string) => {
          expect([provider, id]).toEqual(["openai-codex", "gpt-6-luna-fast"]);
          return model;
        },
        complete: async (requestModel: unknown, _context: unknown, options: unknown) => {
          calls.push({ model: requestModel, options });
          return {
            content: [{ type: "text", text: "Repair title generation" }],
            stopReason: "stop",
          };
        },
      },
    } as unknown as Parameters<typeof generateTitle>[0];

    const title = await generateTitle(ctx, "Fix title generation", "", {
      model: { provider: "openai-codex", id: "gpt-6-luna-fast" },
      thinkingLevel: "low",
    });
    expect(title).toBe("Repair title generation");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe(model);
    expect(calls[0]?.options).toMatchObject({
      maxTokens: 40,
      reasoningEffort: "low",
    });
  });
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});
