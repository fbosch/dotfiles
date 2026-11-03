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
function fixture(initial: readonly RoutingAccount[] = [codex]) {
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
      find: (provider: string, id: string) => physical(provider, id),
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
      expect(result.model.id).toBe(preset.model);
      expect(result.thinkingLevel).toBe(preset.thinking);
      expect(f.activated).toEqual([codex]);
      expect(f.calls()).toBe("allowed" in preset ? 1 : 0);
    });
  }
  test("presents only eligible providers and never sends account identities or quotas to classification", async () => {
    const f = fixture([codex, native, { ...bridge, remaining: 0 }]);
    const route = createVirtualPreset("planning", MODEL_PRESETS.planning, f.dependencies);
    await route.route({ reason: "user", messages }, f.ctx);
    const input = f.input();
    expect(input?.state).toEqual({ prompt: "Inspect the assignment æ ø å", workload: "planning" });
    const encoded = JSON.stringify(input);
    expect(encoded).toContain("claude-sonnet-4-6");
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
});
