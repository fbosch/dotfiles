import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

/** Exercise native adapters without user config, stored credentials, or catalog network access. */
export async function createNativeClassifierRegistry(): Promise<ModelRegistry> {
  const credentials = new InMemoryCredentialStore();
  for (const provider of ["openrouter", "vercel-ai-gateway"]) {
    await credentials.modify(provider, async () => ({
      type: "api_key",
      key: "native-classifier-test-key",
    }));
  }
  const runtime = await ModelRuntime.create({
    credentials,
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  const registry = new ModelRegistry(runtime);
  const template = registry.findOfType("classifier", "openrouter", "typesafe/jev-1.13");
  if (!template) throw new Error("Missing native System One fixture");
  // Pin current route fixtures so tests do not depend on catalog refreshes.
  registry.registerProvider("openrouter", {
    models: [
      ...registry.getModelsOfType("classifier", "openrouter"),
      {
        ...template,
        id: "typesafe/jev-1.14",
        name: "Jev 1.14",
        input: ["text", "image"],
        contextWindow: 262_144,
      },
      {
        ...template,
        id: "openai/gpt-6-luna-decisions",
        name: "Luna Decisions",
        input: ["text", "image"],
        cost: { input: 0.1, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1_050_000,
      },
    ],
  });
  return registry;
}
