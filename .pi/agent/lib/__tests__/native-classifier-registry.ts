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
  return new ModelRegistry(runtime);
}
