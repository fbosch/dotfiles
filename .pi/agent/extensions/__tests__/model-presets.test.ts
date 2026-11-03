import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import type { ExtensionVirtualModel, ModelRoute } from "@earendil-works/pi-coding-agent";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import type { ClassifierRequestContext } from "../../lib/classifier";
import type { RoutingAccount } from "../auth-profiles/routing-eligibility";
import modelPresets, { createVirtualPreset, MODEL_PRESETS, routingPrompt } from "../model-presets";

type Dependencies = Parameters<typeof createVirtualPreset>[2];
const now = 1_000_000;
const codex: RoutingAccount = {
  provider: "openai-codex",
  profile: "kk",
  remaining: 80,
  observedAt: now,
  staleAt: now + 10_000,
};
const native: RoutingAccount = { ...codex, provider: "anthropic", profile: "native" };
const bridge: RoutingAccount = { ...codex, provider: "claude-bridge", profile: "fbb" };
const messages = [
  { role: "user" as const, content: "Inspect the assignment æ ø å", timestamp: now },
];
function physical(provider: string, id: string): ModelRoute["model"] {
  return {
    id,
    provider,
    name: id,
    api: "openai-completions",
    baseUrl: "https://fixture.invalid",
    reasoning: true,
    input: ["text"],
    contextWindow: 200000,
    maxTokens: 32000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    thinkingLevelMap: {
      off: "none",
      minimal: "minimal",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    },
  };
}
function fixture(
  initial: readonly RoutingAccount[] = [codex],
  find: (provider: string, id: string) => ModelRoute["model"] | undefined = physical,
) {
  let accounts = initial;
  let classifyCalls = 0;
  let input: ClassifierRequestContext | undefined;
  const activated: RoutingAccount[] = [];
  const dependencies: Dependencies = {
    accounts: async () => accounts,
    activate: async (account) => {
      activated.push(account);
    },
    classify: async (_registry, request) => {
      classifyCalls++;
      input = request;
      return { ok: false, reason: "disabled", stage: "config" };
    },
    now: () => now,
  };
  const ctx = {
    cwd: "/fixture",
    isProjectTrusted: () => true,
    modelRegistry: {
      find,
      hasConfiguredAuth: () => true,
      findOfType: () => undefined,
      classify: async () => {
        throw new Error("Unexpected native classification");
      },
    },
  };
  return {
    ctx,
    dependencies,
    activated,
    calls: () => classifyCalls,
    input: () => input,
    accounts: (next: readonly RoutingAccount[]) => {
      accounts = next;
    },
  };
}

describe("quota-aware model presets", () => {
  test("registers virtual names without exposing execution routing", () => {
    const entries: ExtensionVirtualModel[] = [];
    modelPresets({
      events: createEventBus(),
      registerVirtualModel: (entry) => {
        entries.push(entry);
      },
    });
    expect(entries.map(({ id }) => id)).toEqual(Object.keys(MODEL_PRESETS));
    expect(entries.every(({ id, name }) => id === name)).toBe(true);
  });
  test("all specialist definitions select supported presets without effort overrides", () => {
    const root = new URL("../../agents/", import.meta.url);
    for (const file of readdirSync(root)) {
      const source = readFileSync(new URL(file, root), "utf8");
      const id = /^model: presets\/(.+)$/mu.exec(source)?.[1];
      expect(Object.hasOwn(MODEL_PRESETS, id ?? "")).toBe(true);
      expect(/^thinking:/mu.test(source)).toBe(false);
    }
  });
  for (const [id, preset] of Object.entries(MODEL_PRESETS)) {
    test(`${id} executes through an eligible local account with supported bounds`, async () => {
      const f = fixture();
      const result = await createVirtualPreset(id, preset, f.dependencies).route(
        { reason: "user", messages },
        f.ctx,
      );
      expect(result.model.provider).toBe("openai-codex");
      expect(`${result.model.provider}/${result.model.id}`).toBe(preset.models[0].model);
      expect(result.thinkingLevel).toBe(preset.models[0].defaultThinking);
      expect(f.activated).toEqual([codex]);
      expect(f.calls()).toBe(preset.models[0].thinking.length > 1 ? 1 : 0);
    });
  }
  test("presents only eligible providers and never sends account identities or quotas to classification", async () => {
    const f = fixture([codex, native, { ...bridge, remaining: 0 }]);
    const route = createVirtualPreset("planning", MODEL_PRESETS.planning, f.dependencies);
    await route.route({ reason: "user", messages }, f.ctx);
    const input = f.input();
    expect(input?.state).toEqual({ prompt: "Inspect the assignment æ ø å", workload: "planning" });
    const encoded = JSON.stringify(input);
    expect(encoded).toContain("claude-sonnet-5-5");
    expect(encoded).not.toContain('"kk"');
    expect(encoded).not.toContain('"native"');
    expect(encoded).not.toContain('"fbb"');
    expect(encoded).not.toContain("remaining");
  });
  test("classifier can choose regular Anthropic or the independently eligible bridge", async () => {
    for (const account of [native, bridge]) {
      const f = fixture([account]);
      f.dependencies.classify = async () => ({
        ok: true,
        value: {
          answers: {
            route: {
              type: "choice",
              choice: "candidate_0",
              probabilities: { candidate_0: 1 },
              confidence: 0.9,
            },
          },
        },
      });
      const result = await createVirtualPreset(
        "planning",
        MODEL_PRESETS.planning,
        f.dependencies,
      ).route({ reason: "user", messages }, f.ctx);
      expect(result.model.provider).toBe(account.provider);
      expect(result.thinkingLevel).toBe("low");
      expect(f.activated).toEqual([account]);
    }
  });
  test("fresh eligibility is checked even when reusing the task decision", async () => {
    const f = fixture([codex, native]);
    const route = createVirtualPreset("planning", MODEL_PRESETS.planning, f.dependencies);
    const first = await route.route({ reason: "user", messages }, f.ctx);
    if (!first.state) throw new Error("Missing route state");
    await route.route({ reason: "continuation", messages, state: first.state }, f.ctx);
    expect(f.calls()).toBe(1);
    f.accounts([native]);
    const next = await route.route({ reason: "retry", messages, state: first.state }, f.ctx);
    expect(next.model.provider).toBe("anthropic");
    expect(f.calls()).toBe(2);
  });
  test("unknown, exhausted, stale, future, and nonfinite quota cannot reach selection", async () => {
    for (const accounts of [
      [],
      [{ ...codex, remaining: 0 }],
      [{ ...codex, staleAt: now }],
      [{ ...codex, observedAt: now + 1 }],
      [{ ...codex, remaining: Number.NaN }],
    ]) {
      const f = fixture(accounts);
      await expect(
        createVirtualPreset("planning", MODEL_PRESETS.planning, f.dependencies).route(
          { reason: "user", messages },
          f.ctx,
        ),
      ).rejects.toThrow("no eligible account");
      expect(f.calls()).toBe(0);
      expect(f.activated).toEqual([]);
    }
  });
  test("an invalid classifier choice falls back only within eligible bounds", async () => {
    const f = fixture([native]);
    f.dependencies.classify = async () => ({
      ok: true,
      value: {
        answers: {
          route: {
            type: "choice",
            choice: "outside",
            probabilities: { outside: 1 },
            confidence: 1,
          },
        },
      },
    });
    const result = await createVirtualPreset(
      "planning",
      MODEL_PRESETS.planning,
      f.dependencies,
    ).route({ reason: "direct", messages }, f.ctx);
    expect(result.model.provider).toBe("anthropic");
    expect(result.thinkingLevel).toBe("medium");
  });
  test("activation failures and cancellation propagate without execution fallback", async () => {
    const f = fixture();
    f.dependencies.activate = async () => {
      throw new Error("Account lost eligibility");
    };
    const route = createVirtualPreset("planning", MODEL_PRESETS.planning, f.dependencies);
    await expect(route.route({ reason: "user", messages }, f.ctx)).rejects.toThrow(
      "lost eligibility",
    );
    await expect(
      route.route({ reason: "user", messages, signal: AbortSignal.abort() }, f.ctx),
    ).rejects.toThrow();
  });
  test("classification sees the bounded latest assignment, not system prompts or credentials", () => {
    expect(
      routingPrompt([{ role: "system", content: "private system", timestamp: now }, ...messages]),
    ).toBe("Inspect the assignment æ ø å");
    expect(
      routingPrompt([
        { role: "user", timestamp: now, content: "-----BEGIN PRIVATE KEY----- secret" },
      ]),
    ).toBe("");
    expect(
      routingPrompt([{ role: "user", timestamp: now, content: "x".repeat(5000) }]),
    ).toHaveLength(2400);
    expect(
      routingPrompt([{ role: "user", timestamp: now, content: "api_key=secret-value" }]),
    ).not.toContain("secret-value");
  });
  test("each provider offers only its own configured thinking levels", async () => {
    const f = fixture([codex, native, bridge]);
    await createVirtualPreset("planning", MODEL_PRESETS.planning, f.dependencies).route(
      { reason: "user", messages },
      f.ctx,
    );
    const criteria = f.input()?.questions.route?.criteria;
    expect(criteria).toEqual({
      candidate_0: "openai-codex/gpt-6.1-sol; reasoning effort low",
      candidate_1: "openai-codex/gpt-6.1-sol; reasoning effort medium",
      candidate_2: "openai-codex/gpt-6.1-sol; reasoning effort high",
      candidate_3: "anthropic/claude-sonnet-5-5; reasoning effort low",
      candidate_4: "anthropic/claude-sonnet-5-5; reasoning effort medium",
      candidate_5: "claude-bridge/claude-sonnet-5-5; reasoning effort low",
      candidate_6: "claude-bridge/claude-sonnet-5-5; reasoning effort medium",
    });
  });

  test("unsupported configured effort fails rather than being silently clamped", async () => {
    const f = fixture([native], (provider, id) => ({
      ...physical(provider, id),
      thinkingLevelMap: {
        off: null,
        minimal: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: null,
        max: null,
      },
    }));
    const route = createVirtualPreset(
      "invalid-effort",
      {
        models: [
          {
            model: "anthropic/fixture-model",
            thinking: ["medium", "xhigh"],
            defaultThinking: "medium",
          },
        ],
      },
      f.dependencies,
    );
    await expect(route.route({ reason: "user", messages }, f.ctx)).rejects.toThrow(
      "does not support configured thinking: xhigh",
    );
    expect(f.calls()).toBe(0);
    expect(f.activated).toEqual([]);
  });

  test("a model policy is independent of model family and has its own default", async () => {
    const f = fixture([native]);
    const route = createVirtualPreset(
      "generic",
      {
        models: [
          {
            model: "anthropic/fixture-model",
            thinking: ["low", "medium"],
            defaultThinking: "low",
          },
        ],
      },
      f.dependencies,
    );
    const result = await route.route({ reason: "direct", messages }, f.ctx);
    expect(result.model.id).toBe("fixture-model");
    expect(result.thinkingLevel).toBe("low");
  });

  test("invalid policy identifiers, duplicate effort levels, and out-of-range defaults fail at registration", () => {
    const f = fixture();
    for (const policy of [
      { model: "/missing-provider", thinking: ["low"], defaultThinking: "low" },
      { model: "anthropic/fixture", thinking: ["low", "low"], defaultThinking: "low" },
      { model: "anthropic/fixture", thinking: ["low"], defaultThinking: "high" },
    ] as const) {
      expect(() => createVirtualPreset("bad-policy", { models: [policy] }, f.dependencies)).toThrow(
        "invalid model policy",
      );
    }
  });

  test("current presets explicitly select Sonnet 5.5 and Opus 5.5 with per-model defaults", () => {
    expect(MODEL_PRESETS.planning.models[1]).toEqual({
      model: "anthropic/claude-sonnet-5-5",
      thinking: ["low", "medium"],
      defaultThinking: "medium",
    });
    expect(MODEL_PRESETS.deliberation.models[1]).toEqual({
      model: "anthropic/claude-opus-5-5",
      thinking: ["medium", "high"],
      defaultThinking: "high",
    });
    expect(MODEL_PRESETS["deep-analysis"].models[1]).toEqual({
      model: "anthropic/claude-opus-5-5",
      thinking: ["high", "max"],
      defaultThinking: "max",
    });
  });

  test("multiple eligible profiles do not duplicate model/effort choices", async () => {
    const f = fixture([codex, { ...codex, profile: "second-profile", remaining: 20 }]);
    await createVirtualPreset("planning", MODEL_PRESETS.planning, f.dependencies).route(
      { reason: "user", messages },
      f.ctx,
    );
    expect(Object.keys(f.input()?.questions.route?.criteria ?? {})).toHaveLength(3);
    expect(f.activated).toEqual([codex]);
  });
});
