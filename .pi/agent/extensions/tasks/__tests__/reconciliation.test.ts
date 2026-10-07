import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClassifierContext } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createNativeClassifierRegistry } from "../../../lib/__tests__/native-classifier-registry";
import {
  type ClassifierFailure,
  createClassifierRequester,
  DEFAULT_CLASSIFIER_TIMEOUT_MS,
  type requestClassifier,
} from "../../../lib/classifier";
import { evaluateReconciliation, type TaskItem } from "../index";

const tasks: [TaskItem, TaskItem, TaskItem] = [
  { id: "review", title: "Review reminder integration", status: "pending" },
  { id: "test", title: "Validate reminder lifecycle", status: "pending" },
  { id: "ui", title: "Adjust panel spacing", status: "completed" },
];
const response = "Rendering is complete. Reminder review and lifecycle validation are paused.";
const ctx = {
  modelRegistry: {},
  cwd: "/fixture",
  isProjectTrusted: () => false,
} as unknown as ExtensionContext;
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function answer(probability: number): ReturnType<typeof requestClassifier> {
  return Promise.resolve({
    ok: true,
    value: { answers: { unnecessary: { type: "bool", probability } } },
  });
}

describe("optional reconciliation classifier", () => {
  test.each([
    [0.03, { remind: true, source: "classifier" }],
    [0.91, { remind: false, source: "classifier" }],
    [0.5, { remind: true, source: "fallback", reason: "uncertain" }],
    [1.1, { remind: true, source: "fallback", reason: "invalid-response" }],
  ] as const)(
    "retains the actual decision source at probability %s",
    async (probability, expected) => {
      expect(
        await evaluateReconciliation(ctx, tasks, response, new AbortController().signal, () =>
          answer(probability),
        ),
      ).toEqual(expected);
    },
  );

  test("sends only unfinished titles/statuses and the final response with shared policy options", async () => {
    let captured: ClassifierContext | undefined;
    const signal = new AbortController().signal;
    const request: typeof requestClassifier = async (registry, input, options) => {
      expect(registry).toBe(ctx.modelRegistry);
      expect(options).toEqual({
        signal,
        timeoutMs: DEFAULT_CLASSIFIER_TIMEOUT_MS,
        settingsContext: ctx,
      });
      captured = input;
      return answer(0.97);
    };
    expect(await evaluateReconciliation(ctx, tasks, response, signal, request)).toEqual({
      remind: false,
      source: "classifier",
    });
    expect(captured?.state).toEqual({
      unfinishedTasks: tasks.slice(0, 2).map(({ title, status }) => ({ title, status })),
      finalResponse: response,
    });
    expect(JSON.stringify(captured)).not.toContain("Adjust panel spacing");
    expect(JSON.stringify(captured)).not.toContain("/fixture");
  });

  test.each([0, 0.5, 0.84, -1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])(
    "does not suppress for uncertain or invalid probability %s",
    async (probability) => {
      expect(
        await evaluateReconciliation(ctx, tasks, response, new AbortController().signal, () =>
          answer(probability),
        ),
      ).toMatchObject({ remind: true });
    },
  );

  const failures: ClassifierFailure["reason"][] = [
    "disabled",
    "model-unavailable",
    "auth-failure",
    "timeout",
    "invalid-response",
    "request-failure",
  ];
  test.each(failures)("falls back to a reminder on %s", async (reason) => {
    const request: typeof requestClassifier = async () => ({ ok: false, reason, stage: "request" });
    expect(
      await evaluateReconciliation(ctx, tasks, response, new AbortController().signal, request),
    ).toEqual({ remind: true, source: "fallback", reason });
  });

  test("falls back on thrown requests and missing answers", async () => {
    const throwing: typeof requestClassifier = async () => {
      throw new Error("fixture failure");
    };
    const missing: typeof requestClassifier = async () => ({ ok: true, value: { answers: {} } });
    for (const request of [throwing, missing]) {
      expect(
        await evaluateReconciliation(ctx, tasks, response, new AbortController().signal, request),
      ).toMatchObject({ remind: true });
    }
  });

  test.each([
    "API_KEY=fixture-secret",
    "OPENAI_API_KEY=fixture-secret",
    "AWS_SECRET_ACCESS_KEY=fixture-secret",
    "Bearer fixture-secret",
    "password: fixture-secret",
    "-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----",
    "Review /Users/example/private-work",
    "Contact person@example.invalid",
    "Open https://example.invalid/?token=fixture",
    "```\nprivate code\n```",
  ])("does not transmit potentially sensitive response or task text: %s", async (text) => {
    let calls = 0;
    const request: typeof requestClassifier = () => {
      calls++;
      return answer(1);
    };
    expect(
      await evaluateReconciliation(ctx, tasks, text, new AbortController().signal, request),
    ).toMatchObject({ remind: true });
    expect(
      await evaluateReconciliation(
        ctx,
        [{ ...tasks[0], title: text }],
        response,
        new AbortController().signal,
        request,
      ),
    ).toMatchObject({ remind: true });
    expect(calls).toBe(0);
  });

  test("skips missing, aborted, or oversized evidence rather than truncating it", async () => {
    let calls = 0;
    const request: typeof requestClassifier = () => {
      calls++;
      return answer(1);
    };
    const signal = new AbortController().signal;
    for (const [items, finalResponse] of [
      [[], response],
      [tasks, ""],
      [tasks, "x".repeat(4_001)],
      [[{ ...tasks[0], title: "long title ".repeat(30) }], response],
      [Array.from({ length: 21 }, (_, index) => ({ ...tasks[0], id: String(index) })), response],
    ] as const) {
      expect(
        await evaluateReconciliation(ctx, items, finalResponse, signal, request),
      ).toMatchObject({ remind: true });
    }
    expect(
      await evaluateReconciliation({} as ExtensionContext, tasks, response, signal, request),
    ).toMatchObject({ remind: true });
    expect(
      await evaluateReconciliation(ctx, tasks, response, AbortSignal.abort(), request),
    ).toMatchObject({ remind: true });
    expect(calls).toBe(0);
  });

  test("respects the real shared classifier master switch without making a provider call", async () => {
    const root = mkdtempSync(join(tmpdir(), "task-classifier-policy-"));
    roots.push(root);
    writeFileSync(join(root, "settings.json"), JSON.stringify({ classifier: { enabled: false } }));
    const registry = await createNativeClassifierRegistry();
    let calls = 0;
    registry.classify = async () => {
      calls++;
      throw new Error("Disabled classifier must not run");
    };
    const context = { ...ctx, cwd: root, modelRegistry: registry } as ExtensionContext;
    expect(
      await evaluateReconciliation(
        context,
        tasks,
        response,
        new AbortController().signal,
        createClassifierRequester(Date.now, root),
      ),
    ).toMatchObject({ remind: true });
    expect(calls).toBe(0);
  });
});
