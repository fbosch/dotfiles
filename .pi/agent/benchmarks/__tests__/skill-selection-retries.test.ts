import { describe, expect, test } from "bun:test";
import { type BenchmarkPrediction, calculateBenchmarkMetrics } from "../skill-selection-metrics";
import {
  DEFAULT_HOSTED_MAX_ATTEMPTS,
  type HostedRetryOptions,
  isHostedRetryableFailure,
  runWithHostedRetries,
} from "../skill-selection-retries";

const options: HostedRetryOptions = {
  pacingDelayMs: 0,
  maxAttempts: DEFAULT_HOSTED_MAX_ATTEMPTS,
  retryBaseMs: 2,
  retryCapMs: 5,
  maxCaseWaitMs: 100,
  maxRunWaitMs: 100,
};

function failure(status: number, extra: { retryAfterMs?: number } = {}): BenchmarkPrediction {
  return {
    names: [],
    latencyMs: 3,
    unavailable: true,
    failure: {
      stage: "request",
      reason: "http-status",
      httpStatus: status,
      ...extra,
    },
  };
}

function success(name = "bun", latencyMs = 3): BenchmarkPrediction {
  return { names: [name], latencyMs };
}

describe("hosted benchmark retries", () => {
  test("only retries transient HTTP, timeout, body, and request failures", () => {
    expect(isHostedRetryableFailure(failure(429))).toBe(true);
    expect(isHostedRetryableFailure(failure(503))).toBe(true);
    expect(
      isHostedRetryableFailure({
        names: [],
        unavailable: true,
        failure: { stage: "auth", reason: "missing-credentials" },
      }),
    ).toBe(false);
    expect(
      isHostedRetryableFailure({
        names: [],
        unavailable: true,
        failure: { stage: "body", reason: "invalid-json" },
      }),
    ).toBe(false);
    expect(isHostedRetryableFailure(failure(400))).toBe(false);
    expect(isHostedRetryableFailure(failure(401))).toBe(false);
    expect(isHostedRetryableFailure(failure(403))).toBe(false);
    expect(
      isHostedRetryableFailure({
        names: [],
        unavailable: true,
        failure: { stage: "request", reason: "caller-cancellation" },
      }),
    ).toBe(false);
  });

  test("keeps explicit bypasses out of hosted attempts and pacing", async () => {
    const waits: number[] = [];
    const result = await runWithHostedRetries(
      [{ explicitSkillInvocation: true }, {}],
      { ...options, pacingDelayMs: 10 },
      async () => success(),
      async (delayMs) => {
        waits.push(delayMs);
      },
    );

    expect(result.complete).toBe(true);
    expect(result.hostedCalls).toBe(1);
    expect(result.cases[0]?.attempts).toEqual([]);
    expect(waits).toEqual([]);
  });

  test("retries the same case before advancing and preserves final metrics", async () => {
    const calls: Array<[number, number]> = [];
    const waits: number[] = [];
    const responses = [failure(503), failure(503), success("bun", 7), success("xstate", 4)];
    const result = await runWithHostedRetries(
      [{}, {}],
      options,
      async (index, attempt) => {
        calls.push([index, attempt]);
        return responses.shift() ?? success();
      },
      async (delayMs) => {
        waits.push(delayMs);
      },
    );

    expect(calls).toEqual([
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 1],
    ]);
    expect(waits).toEqual([2, 4]);
    expect(result.complete).toBe(true);
    expect(result.cases.map(({ retryWaitMs }) => retryWaitMs)).toEqual([6, 0]);
    expect(
      result.cases[0]?.attempts.map(({ elapsedMs, retryWaitMs }) => ({ elapsedMs, retryWaitMs })),
    ).toEqual([
      { elapsedMs: 3, retryWaitMs: 2 },
      { elapsedMs: 3, retryWaitMs: 4 },
      { elapsedMs: 7, retryWaitMs: undefined },
    ]);
    expect(result.cases[0]?.prediction?.latencyMs).toBe(13);

    const metrics = calculateBenchmarkMetrics(
      [
        { name: "first", request: "first", relevant: ["bun"] },
        { name: "second", request: "second", relevant: ["xstate"] },
      ],
      result.cases.map(({ prediction }) => prediction),
    );
    expect(metrics.semanticCoverage).toBe(1);
    expect(metrics.endToEnd.allAttempted).toEqual({
      correctCases: 2,
      denominator: 2,
      caseAccuracy: 1,
    });
  });

  test("caps exponential waits and stops after the total attempt limit", async () => {
    const waits: number[] = [];
    const result = await runWithHostedRetries(
      [{}, {}],
      options,
      async () => failure(500),
      async (delayMs) => {
        waits.push(delayMs);
      },
    );

    expect(waits).toEqual([2, 4, 5, 5]);
    expect(result.hostedCalls).toBe(5);
    expect(result.complete).toBe(false);
    expect(result.stop).toEqual({ caseIndex: 0, reason: "retry-exhausted" });
    expect(result.cases).toHaveLength(1);
  });

  test("honors Retry-After without double sleeping", async () => {
    const waits: number[] = [];
    const result = await runWithHostedRetries(
      [{}],
      { ...options, pacingDelayMs: 10 },
      async (_index, attempt) => (attempt === 1 ? failure(429, { retryAfterMs: 25 }) : success()),
      async (delayMs) => {
        waits.push(delayMs);
      },
    );

    expect(waits).toEqual([25]);
    expect(result.cases[0]?.retryWaitMs).toBe(25);
    expect(result.cases[0]?.attempts[0]?.retryAfterMs).toBe(25);
  });

  test("does not advance after a non-retryable failure and marks remaining cases unattempted", async () => {
    const calls: number[] = [];
    const result = await runWithHostedRetries(
      [{}, {}],
      options,
      async (index) => {
        calls.push(index);
        return failure(400);
      },
      async () => {
        throw new Error("sleep should not happen");
      },
    );

    expect(calls).toEqual([0]);
    expect(result.complete).toBe(false);
    expect(result.stop).toEqual({ caseIndex: 0, reason: "failure" });
    expect(result.cases).toHaveLength(1);
  });

  test("stops before retrying a cancellation", async () => {
    const calls: number[] = [];
    const result = await runWithHostedRetries(
      [{}, {}],
      options,
      async (index) => {
        calls.push(index);
        return {
          names: [],
          unavailable: true,
          failure: { stage: "request", reason: "caller-cancellation" },
        };
      },
      async () => {
        throw new Error("sleep should not happen");
      },
    );

    expect(calls).toEqual([0]);
    expect(result.stop).toEqual({ caseIndex: 0, reason: "cancelled" });
  });

  test("marks a case not-attempted when cancellation interrupts initial pacing", async () => {
    const cancellation = new AbortController();
    const result = await runWithHostedRetries(
      [{}, {}],
      { ...options, pacingDelayMs: 10 },
      async () => success(),
      async () => {
        cancellation.abort();
      },
      1,
      cancellation.signal,
    );

    expect(result.stop).toEqual({ caseIndex: 0, reason: "cancelled" });
    expect(result.cases[0]?.prediction).toBeUndefined();
    expect(result.cases[0]?.attempts).toEqual([]);
  });

  test("saves cancellation during a retry wait without advancing", async () => {
    const cancellation = new AbortController();
    let calls = 0;
    const result = await runWithHostedRetries(
      [{}, {}],
      options,
      async () => {
        calls += 1;
        return failure(503);
      },
      async () => {
        cancellation.abort();
      },
      0,
      cancellation.signal,
    );

    expect(calls).toBe(1);
    expect(result.complete).toBe(false);
    expect(result.stop).toEqual({ caseIndex: 0, reason: "cancelled" });
    expect(result.cases[0]?.prediction?.failure?.reason).toBe("caller-cancellation");
    expect(result.cases[0]?.attempts).toHaveLength(1);
  });

  test("persists an explicit budget failure instead of retrying before Retry-After", async () => {
    const waits: number[] = [];
    const result = await runWithHostedRetries(
      [{}],
      { ...options, maxCaseWaitMs: 20 },
      async () => failure(503, { retryAfterMs: 21 }),
      async (delayMs) => {
        waits.push(delayMs);
      },
    );

    expect(waits).toEqual([]);
    expect(result.complete).toBe(false);
    expect(result.stop).toEqual({ caseIndex: 0, reason: "retry-budget-exhausted" });
    expect(result.cases[0]?.prediction?.failure?.reason).toBe("retry-budget-exhausted");
    expect(result.cases[0]?.attempts).toHaveLength(1);
  });

  test("retries a request failure from a mocked request without network or auth", async () => {
    let calls = 0;
    const result = await runWithHostedRetries(
      [{}],
      { ...options, retryBaseMs: 0 },
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("network detail must stay private");
        return success();
      },
      async () => undefined,
    );

    expect(calls).toBe(2);
    expect(result.complete).toBe(true);
    expect(result.cases[0]?.attempts[0]?.reason).toBe("request-failure");
  });
});
