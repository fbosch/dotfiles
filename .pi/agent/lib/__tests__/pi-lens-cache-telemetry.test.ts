import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const bundle = readFileSync(
  resolve(import.meta.dir, "../../npm/node_modules/pi-lens/dist/index.js"),
  "utf8",
);

function section(startMarker: string, endMarker: string): string {
  const start = bundle.indexOf(startMarker);
  const end = bundle.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Missing Pi Lens section: ${startMarker}`);
  return bundle.slice(start, end);
}

const policy = section("var CACHE_TELEMETRY_ENABLED = ", "\nfunction observeCacheContext(");
const entryPoints = [
  "observeCacheContext",
  "logCacheUsage",
  "observeCachePrefix",
  "recordTurnEndAdvisoryBytes",
  "recordToolResultDelivery",
  "emitCacheUsageSummaryAtSessionEnd",
] as const;
const instrumentation = entryPoints
  .map((name) => `${section(`function ${name}(`, "\n}")}\n}`)
  .join("\n");

test("cache telemetry skips message access, hashing, attribution, and logging", () => {
  const touches: string[] = [];
  const unexpected = (name: string) => () => {
    touches.push(name);
    throw new Error(`Disabled telemetry accessed ${name}`);
  };
  const input = new Proxy(
    {},
    {
      get: (_target, key) => unexpected(`input.${String(key)}`)(),
    },
  );
  const telemetry = runInNewContext(
    `${policy}\n${instrumentation}\n({ ${entryPoints.join(", ")} })`,
    {
      sessionLookupKey: unexpected("sessionLookupKey"),
      attributionFor: unexpected("attributionFor"),
      cacheCellOf: unexpected("cacheCellOf"),
      rollingMessageDigests: unexpected("rollingMessageDigests"),
      logLatency: unexpected("logLatency"),
    },
  ) as Record<(typeof entryPoints)[number], (...args: unknown[]) => unknown>;

  for (const name of entryPoints) {
    const result = telemetry[name](input, input, input, input, input);
    expect(result).toBe(name === "observeCachePrefix" ? "empty" : undefined);
  }
  expect(touches).toEqual([]);
});

test("message_end skips cache attribution even for a stale session", () => {
  let handler: (() => void) | undefined;
  const code = section('  try {\n    pi.on?.("message_end",', "\n  const isPlainUserPrompt = ");
  runInNewContext(`${policy}\n${code}`, {
    lensEnabled: true,
    pi: {
      on: (_event: string, callback: () => void) => {
        handler = callback;
      },
    },
    getStableSessionId: () => {
      throw new Error("Unexpected cache attribution");
    },
    probeCtxActive: () => false,
    surfaceHandlerCrash: (_event: string, error: unknown) => {
      throw error;
    },
    dbg: (message: string) => {
      throw new Error(message);
    },
  });
  if (!handler) throw new Error("message_end handler missing");
  handler();
});

interface Message {
  role: string;
  content: string;
}

function injection(enabled: boolean, injectedText: string) {
  const code = section("  const isPlainUserPrompt = ", "\n  const contextInjectionGuard = ");
  return runInNewContext(`${policy}\n${instrumentation}\n${code}\ninjectIntoRequest`, {
    lensEnabled: true,
    contextInjectionEnabled: enabled,
    getStableSessionId: () => "session",
    classifyOwnedSessionEmission: () => "primary",
    runtime: { turnIndex: 5 },
    getLensFlag: () => false,
    consumeTurnEndFindings: () => ({
      messages: injectedText ? [{ role: "user", content: injectedText }] : [],
    }),
    consumeSessionStartGuidance: () => undefined,
    consumeStagedTestRunnerFindings: () => undefined,
    testRunnerDeliveryOwnerId: "fixture",
    consumeAgentNudge: () => undefined,
    cacheManager: {},
    isStaleExtensionCtxError: () => false,
    scopeOfSession2: () => undefined,
    dbg: (message: string) => {
      throw new Error(message);
    },
  }) as (
    event: { messages: Message[] },
    ctx: { cwd: string },
    hook: string,
  ) => Promise<{ messages: Message[] } | undefined>;
}

test("context injection still augments the latest user prompt without cache telemetry", async () => {
  const system = { role: "system", content: "System prompt" };
  const messages = [system, { role: "user", content: "Fix the bug" }];
  const result = await injection(true, "LSP findings")({ messages }, { cwd: "/repo" }, "context");
  expect(result?.messages).toEqual([
    system,
    { role: "user", content: "Fix the bug\n\nLSP findings" },
  ]);
  expect(result?.messages[0]).toBe(system);
  expect(messages[1]?.content).toBe("Fix the bug");
});

test("context injection still appends diagnostics after an assistant message", async () => {
  const messages = [{ role: "assistant", content: "Working" }];
  const result = await injection(true, "LSP findings")({ messages }, { cwd: "/repo" }, "context");
  expect(result?.messages).toEqual([...messages, { role: "user", content: "LSP findings" }]);
});

test("disabled and empty context injection preserve the request", async () => {
  const messages = [{ role: "user", content: "Fix the bug" }];
  expect(
    await injection(false, "LSP findings")({ messages }, { cwd: "/repo" }, "context"),
  ).toBeUndefined();
  expect(await injection(true, "")({ messages }, { cwd: "/repo" }, "context")).toBeUndefined();
  expect(messages).toEqual([{ role: "user", content: "Fix the bug" }]);
});
