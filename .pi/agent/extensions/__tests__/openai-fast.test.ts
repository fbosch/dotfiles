import { describe, expect, test } from "bun:test";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import {
  applyFastServiceTier,
  createFastPayloadTransform,
  createOpenAIFastProvider,
} from "../openai-fast";

describe("OpenAI fast models", () => {
  test("adds fast aliases only for supported Codex models", () => {
    const provider = createOpenAIFastProvider(openaiCodexProvider());
    const modelIds = provider.getModels().map((model) => model.id);

    expect(modelIds).toContain("gpt-5.4-fast");
    expect(modelIds).toContain("gpt-5.5-fast");
    expect(modelIds).toContain("gpt-5.6-luna-fast");
    expect(modelIds).toContain("gpt-5.6-sol-fast");
    expect(modelIds).toContain("gpt-5.6-terra-fast");
    expect(modelIds).not.toContain("gpt-5.4-mini-fast");
    expect(modelIds).not.toContain("gpt-5.3-codex-spark-fast");
  });

  test("rewrites an alias request to the base model and priority tier", () => {
    expect(
      applyFastServiceTier({ model: "gpt-5.6-luna-fast", stream: true }, "gpt-5.6-luna"),
    ).toEqual({
      model: "gpt-5.6-luna",
      stream: true,
      service_tier: "priority",
    });
  });

  test("preserves other payload transforms while enforcing fast routing", async () => {
    const transform = createFastPayloadTransform("gpt-5.6-luna", (payload) => ({
      ...(payload as Record<string, unknown>),
      model: "wrong-model",
      service_tier: "default",
      temperature: 0.2,
    }));

    await expect(transform({ stream: true }, {} as never)).resolves.toEqual({
      model: "gpt-5.6-luna",
      service_tier: "priority",
      stream: true,
      temperature: 0.2,
    });
  });

  test("rejects malformed provider payloads", () => {
    expect(() => applyFastServiceTier("invalid", "gpt-5.6-luna")).toThrow(
      "OpenAI Codex fast mode requires an object request payload",
    );
  });
});
