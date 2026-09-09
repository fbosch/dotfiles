import { describe, expect, test } from "bun:test";
import openaiCapabilities, {
  applyFastServiceTier,
  applyFastServiceTierForPayload,
  buildFastModelMap,
  resolveFastModelRequest,
} from "../openai-capabilities";

function createCapabilitiesHarness(nativeRegistration = true) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const registrations: unknown[] = [];
  openaiCapabilities({
    on(event: string, handler: unknown) {
      if (typeof handler !== "function") throw new Error("Expected an event handler");
      handlers.set(event, (...args) => handler(...args));
    },
    ...(nativeRegistration
      ? {
          registerOpenAICapabilities(registration: unknown) {
            registrations.push(registration);
          },
        }
      : {}),
  });
  return {
    registrations,
    emit(event: string, ...args: unknown[]) {
      return handlers.get(event)?.(...args);
    },
  };
}

describe("OpenAI capabilities", () => {
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
    expect(resolveFastModelRequest("gpt-5.6-luna-fast")).toEqual({
      modelId: "gpt-5.6-luna",
      serviceTier: "priority",
    });
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
    expect(applyFastServiceTier({}, "gpt-6-astra-fast").model).toBe("gpt-6-astra");
  });

  test("routes from the request model independently of the active session model", () => {
    expect(applyFastServiceTierForPayload({ model: "gpt-5.6-luna-fast", stream: true })).toEqual({
      model: "gpt-5.6-luna",
      stream: true,
      service_tier: "priority",
    });
  });

  test("leaves standard and unrelated requests unchanged", () => {
    expect(resolveFastModelRequest("gpt-5.6-luna")).toBeUndefined();
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

  test("does not register async tools for Astra without changing standard routing", () => {
    const harness = createCapabilitiesHarness();
    expect(harness.registrations).toEqual([]);
    const standardPayload = { model: "gpt-6-astra", stream: true };
    expect(harness.emit("before_provider_request", { payload: standardPayload })).toBeUndefined();
    expect(standardPayload).toEqual({ model: "gpt-6-astra", stream: true });
    const payload = { model: "gpt-6-astra-fast", stream: true, tools: [{ name: "read" }] };
    expect(harness.emit("before_provider_request", { payload })).toEqual({
      ...payload,
      model: "gpt-6-astra",
      service_tier: "priority",
    });
    expect(payload.model).toBe("gpt-6-astra-fast");
    expect(payload.tools).toEqual([{ name: "read" }]);
  });
  test("keeps fast aliases usable without Astra registration", () => {
    const harness = createCapabilitiesHarness(false);
    expect(harness.registrations).toEqual([]);
    expect(
      harness.emit("before_provider_request", { payload: { model: "gpt-5.6-luna-fast" } }),
    ).toEqual({ model: "gpt-5.6-luna", service_tier: "priority" });
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
