import assert from "node:assert/strict";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { classifyQuestion } from "../../../extensions/typesafe-question";
import { type ClassifierRequestContext, installClassifierGate } from "../../classifier";

const runtimeModule = process.argv[2];
const directory = process.argv[3];
assert.ok(runtimeModule);
assert.ok(directory);
const installed: typeof import("@earendil-works/pi-coding-agent") = await import(runtimeModule);
const credentials = new InMemoryCredentialStore();
await credentials.modify("openrouter", async () => ({
  type: "api_key",
  key: "classifier-image-runtime-key",
}));
const runtime = await installed.ModelRuntime.create({
  credentials,
  modelsPath: null,
  refreshOnCreate: false,
  allowModelNetwork: false,
});
const registry = new installed.ModelRegistry(runtime);
const id = "openai/gpt-6-luna-decisions";
// Supply the catalog entry explicitly so the adapter probe needs no catalog network access.
registry.registerProvider("openrouter", {
  models: [
    {
      type: "classifier",
      id,
      name: "Luna Decisions runtime fixture",
      api: "typesafe-system-one",
      baseUrl: "https://openrouter.ai/api/v1",
      input: ["text", "image"],
      cost: { input: 0.1, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1_050_000,
    },
  ],
});
const restore = installClassifierGate(
  registry,
  { cwd: directory, isProjectTrusted: () => false },
  directory,
);
const input: ClassifierRequestContext = {
  state: { task: "Check screenshot" },
  images: [{ type: "image", data: "AAAA", mimeType: "image/png" }],
  questions: {
    clean: {
      type: "bool",
      instructions: "Readable?",
      criteria: { true: "Yes", false: "No" },
    },
  },
};
let fetches = 0;
const fetch = Object.assign(
  async (url: RequestInfo | URL, init?: RequestInit) => {
    fetches++;
    assert.equal(String(url), "https://openrouter.ai/api/alpha/decisions");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer classifier-image-runtime-key",
    );
    assert.deepEqual(JSON.parse(String(init?.body)), {
      model: id,
      state: [
        JSON.stringify(input.state),
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      ],
      questions: { clean: { ...input.questions.clean, type: "noul" } },
    });
    return Response.json({
      answers: { clean: { type: "noul", noul: 0.9 } },
      usage: { input_tokens: 40, output_tokens: 0 },
    });
  },
  { preconnect: globalThis.fetch.preconnect },
);
try {
  const model = registry.findOfType("classifier", "openrouter", id);
  assert.ok(model);
  assert.equal((await registry.classify(model, input, { fetch })).stopReason, "stop");
  const result = await classifyQuestion(input, registry, { fetch, agentDirectory: directory });
  assert.equal(result.answers.clean?.type, "bool");
  assert.equal(result.usage?.input, 40);
  assert.equal(fetches, 2);
  console.log("CLASSIFIER_IMAGE_RUNTIME_OK");
} finally {
  restore();
}
