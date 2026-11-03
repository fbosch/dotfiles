import { expect, test } from "bun:test";
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
