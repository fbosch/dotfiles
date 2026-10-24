import { expect, test } from "bun:test";
import {
  type BeforeAgentStartEvent,
  type BeforeAgentStartEventResult,
  createEventBus,
  type ExtensionAPI,
  type ExtensionContext,
  SessionManager,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import { customStartEvent, userStartEvent } from "../../shared/__tests__/agent-start-events";
import {
  createSkillSelectionExtension,
  DEFAULT_SKILL_SELECTION_CONFIG,
  type SkillSelectionAttempt,
  type SkillSelectionRequestOptions,
} from "../selection";

type StartHandler = (
  event: BeforeAgentStartEvent,
  context: ExtensionContext,
) => Promise<BeforeAgentStartEventResult | undefined>;

const recommendation: SkillSelectionAttempt = {
  ok: true,
  value: {
    recommendations: [{ name: "workflow", score: 0.9 }],
    scores: new Map([["workflow", 0.9]]),
    noMatchScore: 0.1,
  },
};

function harness() {
  const handlers = new Map<string, StartHandler>();
  const pending: {
    options: SkillSelectionRequestOptions;
    resolve: (attempt: SkillSelectionAttempt) => void;
    reject: (error: Error) => void;
  }[] = [];
  const entries: unknown[] = [];
  const notifications: string[] = [];
  let statusCommand: (() => Promise<void>) | undefined;
  const context = {
    cwd: "/tmp/skill-selection-lifecycle",
    sessionManager: SessionManager.inMemory(),
    ui: { notify: (message: string) => notifications.push(message) },
  } as unknown as ExtensionContext;
  createSkillSelectionExtension({
    getConfig: () => ({ ...DEFAULT_SKILL_SELECTION_CONFIG, enabled: true }),
    getDisabledNames: () => new Set(),
    selectSkillsDetailed: (_prompt, _candidates, _config, options) =>
      new Promise((resolve, reject) => pending.push({ options, resolve, reject })),
  })({
    events: createEventBus(),
    registerEntryRenderer: () => {},
    appendEntry: (_type: string, data: unknown) => entries.push(data),
    registerCommand: (
      _name: string,
      definition: { handler: (args: string, context: ExtensionContext) => Promise<void> },
    ) => {
      statusCommand = () => definition.handler("", context);
    },
    on: (name: string, handler: StartHandler) => handlers.set(name, handler),
  } as unknown as ExtensionAPI);
  const event = userStartEvent("Use the workflow");
  event.systemPromptOptions.skills = [
    {
      name: "workflow",
      description: "Apply the workflow",
      filePath: "/skills/workflow/SKILL.md",
      baseDir: "/skills/workflow",
      sourceInfo: {} as Skill["sourceInfo"],
      disableModelInvocation: false,
    },
  ];
  const emit = (name: string, input: BeforeAgentStartEvent = event, ctx = context) => {
    const handler = handlers.get(name);
    if (!handler) throw new Error(`Missing handler: ${name}`);
    return handler(input, ctx);
  };
  const status = async () => {
    if (!statusCommand) throw new Error("Missing status command");
    await statusCommand();
    return JSON.parse(notifications.at(-1) ?? "{}");
  };
  return { emit, event, context, pending, entries, status };
}

test.each(["session_start", "session_tree", "session_shutdown", "new-request", "custom-start"])(
  "invalidates pending input-time advice on %s",
  async (boundary) => {
    const h = harness();
    const old = h.emit("before_agent_start");
    expect(h.pending).toHaveLength(1);
    const request = h.pending[0];
    if (!request) throw new Error("Missing classifier request");
    let next: ReturnType<typeof h.emit> | undefined;
    if (boundary === "new-request") next = h.emit("before_agent_start");
    else if (boundary === "custom-start") await h.emit("before_agent_start", customStartEvent());
    else await h.emit(boundary);
    expect(request.options.signal?.aborted).toBe(true);
    const before = await h.status();
    request.options.onFetchAttempt?.();
    request.resolve(recommendation);
    expect(await old).toBeUndefined();
    expect(h.entries).toEqual([]);
    expect(await h.status()).toEqual(before);
    if (next) {
      h.pending[1]?.resolve(recommendation);
      expect(await next).toMatchObject({ message: { customType: "skill-recommendation-advice" } });
      expect(h.entries).toEqual([{ skills: ["workflow"] }]);
    }
  },
);

test("discards advice when the caller aborts even if classification succeeds", async () => {
  const h = harness();
  const controller = new AbortController();
  const pending = h.emit("before_agent_start", h.event, {
    ...h.context,
    signal: controller.signal,
  });
  controller.abort();
  expect(h.pending[0]?.options.signal?.aborted).toBe(true);
  h.pending[0]?.resolve(recommendation);
  expect(await pending).toBeUndefined();
  expect(h.entries).toEqual([]);
  expect(await h.status()).toMatchObject({ state: "cancelled", reason: "caller-cancellation" });
});

test("stale failures do not overwrite the newer request's lifecycle status", async () => {
  const h = harness();
  const old = h.emit("before_agent_start");
  const next = h.emit("before_agent_start");
  const before = await h.status();
  h.pending[0]?.reject(new Error("Old classifier failed"));
  expect(await old).toBeUndefined();
  expect(await h.status()).toEqual(before);
  h.pending[1]?.resolve(recommendation);
  expect(await next).toMatchObject({ message: { customType: "skill-recommendation-advice" } });
});
