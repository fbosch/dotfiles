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

type AgentEndHandler = (event: unknown, ctx: ExtensionContext) => Promise<unknown> | unknown;

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
    expect(result.stdout.toString().trim()).toBe("session_start,before_agent_start,agent_end");
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
      let agentEnd: AgentEndHandler | undefined;
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
          if (event === "agent_end") agentEnd = handler as AgentEndHandler;
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
      await agentEnd?.({}, ctx);
      expect(guidanceLoads).toBe(1);

      sessionName = undefined;
      sessionStart?.({}, ctx);
      await beforeAgentStart?.({ prompt: "Second request" } as BeforeAgentStartEvent, ctx);
      await agentEnd?.({}, ctx);

      expect(guidanceLoads).toBe(1);
      expect(systemPrompts).toHaveLength(2);
      expect(systemPrompts[0]).toContain("Guidance 1");
      expect(systemPrompts[1]).toBe(systemPrompts[0]);
    } finally {
      if (previousAgentDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
    }
  });

  test("asks Jev after completed turns and regenerates only for stale titles", async () => {
    const agentDirectory = mkdtempSync(join(tmpdir(), "auto-session-title-agent-"));
    temporaryDirectories.push(agentDirectory);
    writeFileSync(join(agentDirectory, "settings.json"), "{}");
    const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDirectory;

    try {
      let sessionName: string | undefined;
      const titleRequests: string[] = [];
      const jevRequests: unknown[] = [];
      const notifications: string[] = [];
      const judgments = [0.79, 0.8];
      let sessionStart: SessionStartHandler | undefined;
      let beforeAgentStart: BeforeAgentStartHandler | undefined;
      let agentEnd: AgentEndHandler | undefined;
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
          if (event === "agent_end") agentEnd = handler as AgentEndHandler;
        },
      } as unknown as ExtensionAPI;
      const ctx = {
        signal: new AbortController().signal,
        hasUI: true,
        sessionManager: { getBranch: () => [] },
        ui: { notify: (message: string) => notifications.push(message) },
        modelRegistry: {
          find: () => ({}),
          complete: async (
            _model: unknown,
            request: { messages: Array<{ content: Array<{ text: string }> }> },
          ) => {
            titleRequests.push(request.messages[0]?.content[0]?.text ?? "");
            return {
              content: [{ type: "text", text: `Generated title ${titleRequests.length}` }],
              stopReason: "stop",
            };
          },
        },
      } as unknown as ExtensionContext;

      await autoSessionTitle(
        pi,
        async () => "Writing guidance",
        async (input) => {
          jevRequests.push(input);
          if (jevRequests.length === 3) throw new Error("Jev unavailable");
          return {
            title_stale: { type: "bool", probability: judgments[jevRequests.length - 1] ?? 0 },
          };
        },
      );
      sessionStart?.({}, ctx);

      await beforeAgentStart?.({ prompt: "Build the feature" } as BeforeAgentStartEvent, ctx);
      expect(titleRequests).toHaveLength(0);
      await agentEnd?.({}, ctx);
      expect(sessionName).toBe("Generated title 1");
      expect(titleRequests).toHaveLength(1);
      expect(jevRequests).toHaveLength(0);

      await beforeAgentStart?.({ prompt: "Add a regression test" } as BeforeAgentStartEvent, ctx);
      expect(jevRequests).toHaveLength(0);
      await agentEnd?.({}, ctx);
      expect(sessionName).toBe("Generated title 1");
      expect(titleRequests).toHaveLength(1);

      await beforeAgentStart?.(
        { prompt: "Actually, replace the feature with a CLI command" } as BeforeAgentStartEvent,
        ctx,
      );
      await agentEnd?.({}, ctx);
      expect(sessionName).toBe("Generated title 2");
      expect(titleRequests).toHaveLength(2);
      expect(jevRequests).toHaveLength(2);
      expect(jevRequests[0]).toMatchObject({
        state: { currentTitle: "Generated title 1", latestUserPrompt: "Add a regression test" },
        questions: { title_stale: { type: "bool" } },
      });
      expect(jevRequests[1]).toMatchObject({
        state: {
          currentTitle: "Generated title 1",
          latestUserPrompt: "Actually, replace the feature with a CLI command",
        },
        questions: { title_stale: { type: "bool" } },
      });
      expect(titleRequests.map((request) => JSON.parse(request).conversation)).toEqual([
        "Build the feature",
        "Build the feature\n\nAdd a regression test\n\nActually, replace the feature with a CLI command",
      ]);

      await beforeAgentStart?.({ prompt: "Continue the same task" } as BeforeAgentStartEvent, ctx);
      await agentEnd?.({}, ctx);
      expect(sessionName).toBe("Generated title 2");
      expect(titleRequests).toHaveLength(2);
      expect(jevRequests).toHaveLength(3);
      expect(notifications).toEqual([
        "Could not assess whether the session title is stale: Jev unavailable",
      ]);
      sessionName = "Manual title";
      await beforeAgentStart?.({ prompt: "Another follow-up" } as BeforeAgentStartEvent, ctx);
      await agentEnd?.({}, ctx);
      expect(sessionName).toBe("Manual title");
      expect(jevRequests).toHaveLength(3);
      expect(titleRequests).toHaveLength(2);
    } finally {
      if (previousAgentDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
    }
  });

  test("ignores aborted stale-title requests without hiding later Jev failures", async () => {
    const agentDirectory = mkdtempSync(join(tmpdir(), "auto-session-title-agent-"));
    temporaryDirectories.push(agentDirectory);
    writeFileSync(join(agentDirectory, "settings.json"), "{}");
    const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDirectory;

    try {
      let sessionName: string | undefined;
      let activeRequestController = new AbortController();
      let requestSignal = activeRequestController.signal;
      let staleChecks = 0;
      const titleRequests: string[] = [];
      const notifications: string[] = [];
      let sessionStart: SessionStartHandler | undefined;
      let beforeAgentStart: BeforeAgentStartHandler | undefined;
      let agentEnd: AgentEndHandler | undefined;
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
          if (event === "agent_end") agentEnd = handler as AgentEndHandler;
        },
      } as unknown as ExtensionAPI;
      const ctx = {
        get signal() {
          return requestSignal;
        },
        hasUI: true,
        sessionManager: { getBranch: () => [] },
        ui: { notify: (message: string) => notifications.push(message) },
        modelRegistry: {
          find: () => ({}),
          complete: async (
            _model: unknown,
            request: { messages: Array<{ content: Array<{ text: string }> }> },
          ) => {
            titleRequests.push(request.messages[0]?.content[0]?.text ?? "");
            return {
              content: [{ type: "text", text: `Generated title ${titleRequests.length}` }],
              stopReason: "stop",
            };
          },
        },
      } as unknown as ExtensionContext;

      await autoSessionTitle(
        pi,
        async () => "Writing guidance",
        async () => {
          staleChecks += 1;
          if (staleChecks === 1) {
            activeRequestController.abort();
            throw new Error("Request cancelled");
          }
          throw new Error("Jev unavailable");
        },
      );
      sessionStart?.({}, ctx);
      await beforeAgentStart?.({ prompt: "Build the feature" } as BeforeAgentStartEvent, ctx);
      await agentEnd?.({}, ctx);
      expect(sessionName).toBe("Generated title 1");

      activeRequestController = new AbortController();
      activeRequestController.abort();
      requestSignal = activeRequestController.signal;
      await beforeAgentStart?.({ prompt: "Clarify the feature" } as BeforeAgentStartEvent, ctx);
      await agentEnd?.({}, ctx);
      expect(staleChecks).toBe(0);
      expect(sessionName).toBe("Generated title 1");
      expect(titleRequests).toHaveLength(1);
      expect(notifications).toEqual([]);

      activeRequestController = new AbortController();
      requestSignal = activeRequestController.signal;
      await beforeAgentStart?.({ prompt: "Continue the feature" } as BeforeAgentStartEvent, ctx);
      await agentEnd?.({}, ctx);
      expect(staleChecks).toBe(1);
      expect(sessionName).toBe("Generated title 1");
      expect(titleRequests).toHaveLength(1);
      expect(notifications).toEqual([]);

      requestSignal = new AbortController().signal;
      await beforeAgentStart?.(
        { prompt: "Add an implementation detail" } as BeforeAgentStartEvent,
        ctx,
      );
      await agentEnd?.({}, ctx);
      expect(staleChecks).toBe(2);
      expect(sessionName).toBe("Generated title 1");
      expect(titleRequests).toHaveLength(1);
      expect(notifications).toEqual([
        "Could not assess whether the session title is stale: Jev unavailable",
      ]);
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
      let agentEnd: AgentEndHandler | undefined;
      const pi = {
        getSessionName: () => undefined,
        setSessionName: () => {},
        on(event: string, handler: unknown) {
          if (event === "session_start") sessionStart = handler as SessionStartHandler;
          if (event === "before_agent_start") {
            beforeAgentStart = handler as BeforeAgentStartHandler;
          }
          if (event === "agent_end") agentEnd = handler as AgentEndHandler;
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
      await agentEnd?.({}, ctx);
      await beforeAgentStart?.({ prompt: "Second request" } as BeforeAgentStartEvent, ctx);
      await agentEnd?.({}, ctx);

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
