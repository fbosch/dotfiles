import { describe, expect, test } from "bun:test";
import { applyFastServiceTier, applyFastServiceTierForPayload } from "../openai-fast";

describe("OpenAI fast models", () => {
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
});
