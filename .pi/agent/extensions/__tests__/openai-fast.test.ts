import { describe, expect, test } from "bun:test";
import {
  applyFastServiceTier,
  applyFastServiceTierForPayload,
  buildFastModelMap,
} from "../openai-fast";

describe("OpenAI fast models", () => {
  test("derives future fast aliases from models.json entries", () => {
    const models = buildFastModelMap({
      providers: {
        "openai-codex": {
          models: [{ id: "gpt-5.7-nova" }, { id: "gpt-5.7-nova-fast" }],
        },
      },
    });

    expect(models.get("gpt-5.7-nova-fast")).toBe("gpt-5.7-nova");
  });

  test("rewrites an alias request to the base model and priority tier", () => {
    expect(
      applyFastServiceTier({ model: "gpt-5.6-luna-fast", stream: true }, "gpt-5.6-luna-fast"),
    ).toEqual({
      model: "gpt-5.6-luna",
      stream: true,
      service_tier: "priority",
    });
  });

  test("routes each configured fast model", () => {
    expect(applyFastServiceTier({}, "gpt-5.6-sol-fast").model).toBe("gpt-5.6-sol");
    expect(applyFastServiceTier({}, "gpt-5.6-terra-fast").model).toBe("gpt-5.6-terra");
  });

  test("routes from the request model independently of the active session model", () => {
    expect(applyFastServiceTierForPayload({ model: "gpt-5.6-luna-fast", stream: true })).toEqual({
      model: "gpt-5.6-luna",
      stream: true,
      service_tier: "priority",
    });
  });

  test("leaves standard and unrelated requests unchanged", () => {
    expect(applyFastServiceTierForPayload({ model: "gpt-5.6-luna" })).toBeUndefined();
    expect(applyFastServiceTierForPayload({ model: "claude-sonnet-5" })).toBeUndefined();
    expect(applyFastServiceTierForPayload("invalid")).toBeUndefined();
  });

  test("rejects unsupported models and malformed provider payloads", () => {
    expect(() => applyFastServiceTier({}, "gpt-5.4-fast")).toThrow(
      "Unsupported OpenAI Codex fast model: gpt-5.4-fast",
    );
    expect(() => applyFastServiceTier("invalid", "gpt-5.6-luna-fast")).toThrow(
      "OpenAI Codex fast mode requires an object request payload",
    );
  });

  test("rejects malformed fast-model configuration", () => {
    expect(() => buildFastModelMap({ providers: {} })).toThrow(
      "models.json must define openai-codex models",
    );
    expect(() =>
      buildFastModelMap({ providers: { "openai-codex": { models: [{ id: "gpt-5.7" }] } } }),
    ).toThrow("models.json defines no OpenAI Codex fast models");
  });
});
