import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getSupportedThinkingLevels, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { MODEL_PRESETS } from "../model-presets";

test("configured model policies match the installed provider capabilities", async () => {
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: fileURLToPath(new URL("../../models.json", import.meta.url)),
    refreshOnCreate: false,
    allowModelNetwork: false,
    executorSocket: null,
  });
  const settings = JSON.parse(
    readFileSync(new URL("../../settings.json", import.meta.url), "utf8"),
  );
  expect(settings.defaultProvider).toBe("openai-codex");
  expect(settings.defaultModel).toBe("gpt-6.1-terra-fast");
  expect(settings.defaultThinkingLevel).toBe("medium");
  const defaultModel = runtime.getModel(settings.defaultProvider, settings.defaultModel);
  if (!defaultModel) throw new Error("Missing configured default model");
  expect(getSupportedThinkingLevels(defaultModel)).toContain(settings.defaultThinkingLevel);
  // The installed bridge projects the native catalog's thinkingLevelMap unchanged.
  runtime.registerProvider("claude-bridge", {
    api: "anthropic-messages",
    models: runtime
      .getModels("anthropic")
      .map((model) => ({ ...model, provider: "claude-bridge" })),
  });
  for (const [preset, { models }] of Object.entries(MODEL_PRESETS)) {
    for (const policy of models) {
      const split = policy.model.indexOf("/");
      const provider = policy.model.slice(0, split);
      const id = policy.model.slice(split + 1);
      const model = runtime.getModel(provider, id);
      if (!model) throw new Error(`${preset}: missing configured model ${policy.model}`);
      const supported = getSupportedThinkingLevels(model);
      for (const thinking of policy.thinking) expect(supported).toContain(thinking);
      expect([...policy.thinking]).toContain(policy.defaultThinking);
    }
  }
  for (const family of ["sonnet", "opus"]) {
    const latest = runtime
      .getModels("anthropic")
      .filter(({ id }) => new RegExp(`^claude-${family}-\\d+(?:-\\d+)?$`, "u").test(id))
      .map(({ id }) => id)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
    if (!latest) throw new Error(`Missing ${family} catalog models`);
    const configured = Object.values(MODEL_PRESETS).flatMap(({ models }) =>
      models
        .filter(({ model }) => model.includes(`/claude-${family}-`))
        .map(({ model }) => model.split("/")[1]),
    );
    expect(configured.length).toBeGreaterThan(0);
    expect(configured.every((id) => id === latest)).toBe(true);
  }
});

test("Astra and Sol 6.2 load offline with current limits, reasoning, and base pricing", async () => {
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: fileURLToPath(new URL("../../models.json", import.meta.url)),
    refreshOnCreate: false,
    allowModelNetwork: false,
    executorSocket: null,
  });
  for (const [family, input, output, cacheRead, cacheWrite] of [
    ["sol", 2, 10, 0.1, 2.5],
    ["astra", 8, 40, 0.4, 10],
  ] as const) {
    for (const suffix of ["", "-fast"]) {
      const id = `gpt-6.2-${family}${suffix}`;
      const model = runtime.getModel("openai-codex", id);
      if (!model) throw new Error(`Missing configured model ${id}`);
      expect(model.api).toBe("openai-codex-responses");
      expect(model.contextWindow).toBe(1_050_000);
      expect(model.maxTokens).toBe(128_000);
      expect(model.input).toEqual(["text", "image"]);
      expect(model.thinkingLevelMap).toEqual({
        off: null,
        minimal: "low",
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max",
      });
      expect(getSupportedThinkingLevels(model)).toEqual([
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ]);
      expect(model.compat).toMatchObject({
        supportsMidConvoSystemMessages: true,
        supportsAdditionalTools: true,
        supportsToolSearch: true,
      });
      // The Codex adapter applies the returned priority tier multiplier once.
      expect(model.cost).toEqual({
        input,
        output,
        cacheRead,
        cacheWrite,
        tiers: [
          {
            inputTokensAbove: 272_000,
            input: input * 2,
            output: output * 1.5,
            cacheRead: cacheRead * 2,
            cacheWrite: cacheWrite * 2,
          },
        ],
      });
    }
  }
});
