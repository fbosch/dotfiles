import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClassifierContext } from "@earendil-works/pi-ai";
import {
  type ClassifierSettingsContext,
  createClassifierRequester,
  installClassifierGate,
  resolveClassifierEnabled,
} from "../classifier";
import { createNativeClassifierRegistry } from "./native-classifier-registry";

const input: ClassifierContext = {
  state: {},
  questions: {
    gate: { type: "bool", instructions: "Check", criteria: { true: "Yes", false: "No" } },
  },
};
let root: string;
let agentDirectory: string;
let cwd: string;
const restorers: Array<() => void> = [];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "classifier-policy-"));
  agentDirectory = join(root, "agent");
  cwd = join(root, "project");
  mkdirSync(agentDirectory);
  mkdirSync(join(cwd, ".pi"), { recursive: true });
});
afterEach(() => {
  for (const restore of restorers.splice(0).reverse()) restore();
  rmSync(root, { recursive: true, force: true });
});
function settings(global: unknown, project: unknown = {}) {
  writeFileSync(join(agentDirectory, "settings.json"), JSON.stringify(global));
  writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify(project));
}
function context(trusted = true): ClassifierSettingsContext {
  return { cwd, isProjectTrusted: () => trusted };
}
function response(): Response {
  return Response.json({
    answers: {
      gate: {
        type: "noul",
        noul: 0.9,
        trueProbability: 0.9,
        falseProbability: 0.1,
        confidence: 0.9,
      },
    },
  });
}

describe("classifier master switch", () => {
  test("defaults on and only permits project opt-out", () => {
    expect(resolveClassifierEnabled(undefined, undefined)).toBe(true);
    expect(resolveClassifierEnabled({}, {})).toBe(true);
    expect(
      resolveClassifierEnabled(
        { classifier: { enabled: false } },
        { classifier: { enabled: true } },
      ),
    ).toBe(false);
    expect(
      resolveClassifierEnabled(
        { classifier: { enabled: true } },
        { classifier: { enabled: false } },
      ),
    ).toBe(false);
    expect(resolveClassifierEnabled({ classifier: { enabled: "false" } }, {})).toBeUndefined();
    expect(resolveClassifierEnabled({}, { classifier: { enabled: null } })).toBeUndefined();
  });

  test.each([
    [{ classifier: { enabled: false } }, { classifier: { enabled: true } }, "disabled"],
    [{}, { classifier: { enabled: false } }, "disabled"],
    [{ classifier: { enabled: "no" } }, {}, "invalid-config"],
    [{}, { classifier: { enabled: null } }, "invalid-config"],
  ] as const)("rejects before model lookup or fetch: %j / %j", async (global, project, reason) => {
    settings(global, project);
    let lookups = 0;
    let calls = 0;
    const native = await createNativeClassifierRegistry();
    const result = await createClassifierRequester(Date.now, agentDirectory)(
      {
        findOfType: (...args) => {
          lookups++;
          return native.findOfType(...args);
        },
        classify: (...args) => {
          calls++;
          return native.classify(...args);
        },
      },
      input,
      {
        settingsContext: context(),
        fetch: async () => {
          calls++;
          return response();
        },
      },
    );
    expect(result).toEqual({ ok: false, stage: "config", reason });
    expect(lookups).toBe(0);
    expect(calls).toBe(0);
  });

  test("ignores untrusted project opt-out and malformed project files", async () => {
    settings(
      { classifier: { providers: [{ provider: "openrouter", model: "typesafe/jev-1.13" }] } },
      { classifier: { enabled: false } },
    );
    writeFileSync(join(cwd, ".pi", "settings.json"), "invalid json");
    let calls = 0;
    const result = await createClassifierRequester(Date.now, agentDirectory)(
      await createNativeClassifierRegistry(),
      input,
      {
        settingsContext: context(false),
        fetch: async () => {
          calls++;
          return response();
        },
      },
    );
    expect(result.ok).toBe(true);
    expect(calls).toBe(1);
  });

  test("malformed trusted JSON fails without fetching", async () => {
    settings({});
    writeFileSync(join(cwd, ".pi", "settings.json"), "invalid json");
    let calls = 0;
    const result = await createClassifierRequester(Date.now, agentDirectory)(
      await createNativeClassifierRegistry(),
      input,
      {
        settingsContext: context(),
        fetch: async () => {
          calls++;
          return response();
        },
      },
    );
    expect(result).toEqual({ ok: false, stage: "config", reason: "invalid-config" });
    expect(calls).toBe(0);
  });

  test("native boundary and requester inherit session context and re-read changes", async () => {
    settings({}, { classifier: { enabled: false } });
    const registry = await createNativeClassifierRegistry();
    const original = registry.classify;
    restorers.push(installClassifierGate(registry, context(), agentDirectory));
    const model = registry.findOfType("classifier", "openrouter", "typesafe/jev-1.13");
    if (!model) throw new Error("Missing fixture model");
    let calls = 0;
    const fetch = Object.assign(
      async () => {
        calls++;
        return response();
      },
      { preconnect: globalThis.fetch.preconnect },
    );
    const result = await registry.classify(model, input, { fetch });
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("Classifier disabled by settings");
    expect(
      await createClassifierRequester(Date.now, agentDirectory)(registry, input, { fetch }),
    ).toEqual({ ok: false, stage: "config", reason: "disabled" });
    expect(calls).toBe(0);
    settings({});
    expect((await registry.classify(model, input, { fetch })).stopReason).toBe("stop");
    expect(calls).toBe(1);
    settings({ classifier: { enabled: false } }, { classifier: { enabled: true } });
    expect((await registry.classify(model, input, { fetch })).stopReason).toBe("error");
    expect(calls).toBe(1);
    settings({ classifier: { providers: [] } });
    const invalid = await registry.classify(model, input, { fetch });
    expect(invalid.stopReason).toBe("error");
    expect(invalid.errorMessage).toBe("Invalid classifier settings");
    expect(calls).toBe(1);
    restorers.pop()?.();
    expect(registry.classify).toBe(original);
  });

  test("registry contexts remain isolated", async () => {
    settings({}, { classifier: { enabled: false } });
    const blocked = await createNativeClassifierRegistry();
    const allowed = await createNativeClassifierRegistry();
    restorers.push(installClassifierGate(blocked, context(), agentDirectory));
    restorers.push(installClassifierGate(allowed, context(false), agentDirectory));
    const request = createClassifierRequester(Date.now, agentDirectory);
    expect(await request(blocked, input)).toEqual({
      ok: false,
      stage: "config",
      reason: "disabled",
    });
    expect((await request(allowed, input, { fetch: async () => response() })).ok).toBe(true);
  });
});
