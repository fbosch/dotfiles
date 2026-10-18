import { describe, expect, test } from "bun:test";
import { parseOptions } from "../browser-comparison";
import { createFixture, EMAIL, type FixtureState, judge } from "../browser-comparison-fixture";
import {
  addUsage,
  median,
  orderedArms,
  type Sample,
  summarize,
  tokenTotals,
} from "../browser-comparison-metrics";

function state(caseId: FixtureState["caseId"] = "form"): FixtureState {
  return {
    caseId,
    view: "home",
    fields: { profile: "", billing: "", shipping: "shipping@example.test", verification: "" },
    saves: [],
    updates: 0,
    unsafe: 0,
    code: "mint-test",
  };
}
function sample(overrides: Partial<Sample> = {}): Sample {
  return {
    phase: "agent",
    arm: "raw",
    caseId: "form",
    repetition: 0,
    warmup: false,
    durationMs: 10,
    success: true,
    verdict: {
      success: true,
      wrongTarget: false,
      duplicateSaves: 0,
      unsafeActions: 0,
      unintendedChanges: false,
    },
    calls: [],
    modelTurns: 1,
    classifierCalls: 0,
    classifierAttempts: 0,
    classifierModels: [],
    primaryUsage: tokenTotals(),
    classifierUsage: tokenTotals(),
    stopReasons: [],
    ...overrides,
  };
}

describe("browser comparison correctness oracle", () => {
  test("requires the requested saved value and retains wrong-target, duplicate and unsafe failures", () => {
    const valid = state();
    valid.fields.profile = EMAIL;
    valid.saves.push({ section: "profile", value: EMAIL });
    expect(judge(valid).success).toBe(true);
    const duplicate = structuredClone(valid);
    duplicate.saves.push({ section: "profile", value: EMAIL });
    expect(judge(duplicate)).toMatchObject({ success: false, duplicateSaves: 1 });
    const wrong = structuredClone(valid);
    wrong.fields.shipping = EMAIL;
    expect(judge(wrong)).toMatchObject({ success: false, wrongTarget: true });
    const unsafe = structuredClone(valid);
    unsafe.unsafe = 1;
    expect(judge(unsafe)).toMatchObject({ success: false, unsafeActions: 1 });
  });

  test("requires billing rather than an identically labelled shipping control", () => {
    const correct = state("ambiguous");
    correct.fields.billing = EMAIL;
    correct.saves.push({ section: "billing", value: EMAIL });
    expect(judge(correct).success).toBe(true);
    correct.saves[0] = { section: "shipping", value: EMAIL };
    expect(judge(correct)).toMatchObject({ success: false, wrongTarget: true });
  });

  test("checks navigation and console-derived verification against private fixture state", () => {
    const navigation = state("navigation");
    expect(judge(navigation).success).toBe(false);
    navigation.view = "settings";
    expect(judge(navigation).success).toBe(true);
    const diagnostic = state("diagnostics");
    diagnostic.saves.push({ section: "verification", value: "invented" });
    expect(judge(diagnostic).success).toBe(false);
    diagnostic.saves[0] = { section: "verification", value: diagnostic.code };
    expect(judge(diagnostic).success).toBe(true);
  });

  test("isolates per-trial HTTP pages and records durable effects without exposing an oracle endpoint", async () => {
    const fixture = createFixture();
    try {
      const first = fixture.create("form");
      const second = fixture.create("form");
      expect((await fetch(first.url)).status).toBe(200);
      const endpoint = first.url.replace("/page/", "/event/");
      for (const kind of ["field", "save"]) {
        expect(
          (
            await fetch(endpoint, {
              method: "POST",
              body: JSON.stringify({ kind, section: "profile", value: EMAIL }),
            })
          ).status,
        ).toBe(200);
      }
      expect(judge(first.state()).success).toBe(true);
      expect(judge(second.state()).success).toBe(false);
      expect((await fetch(first.url.replace("/page/", "/state/"))).status).toBe(404);
    } finally {
      fixture.stop();
    }
  });
});

describe("browser comparison measurement", () => {
  test("counterbalances paired arm order without changing the supplied modes", () => {
    const arms = ["raw", "deterministic", "orchestrated"] as const;
    expect(orderedArms(arms, 0)).toEqual([...arms]);
    expect(orderedArms(arms, 1)).toEqual(["deterministic", "orchestrated", "raw"]);
    expect(orderedArms(arms, 2)).toEqual(["orchestrated", "raw", "deterministic"]);
    expect(arms).toEqual(["raw", "deterministic", "orchestrated"]);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([8, 2])).toBe(5);
    expect(() => median([])).toThrow();
  });

  test("pairs the same case and repetition, excludes warmups and retains task failures", () => {
    const report = summarize([
      sample(),
      sample({ arm: "deterministic", durationMs: 20, success: false }),
      sample({ repetition: -1, warmup: true, durationMs: 999 }),
      sample({ caseId: "navigation", arm: "orchestrated", durationMs: 30 }),
    ]);
    expect(report.groups.find((g) => g.key === "agent/form/raw")?.samples).toBe(1);
    expect(report.groups.find((g) => g.key === "agent/form/deterministic")?.successful).toBe(0);
    expect(report.paired).toEqual([
      {
        phase: "agent",
        caseId: "form",
        repetition: 0,
        arm: "deterministic",
        deltaMs: 10,
        deltaPercent: 100,
        rawSuccess: true,
        candidateSuccess: false,
      },
    ]);
  });

  test("distinguishes missing classifier usage from measured zero cost and counts only direct native fallbacks", () => {
    const usage = tokenTotals();
    addUsage(usage, undefined);
    expect(usage.missingUsageCalls).toBe(1);
    addUsage(usage, {
      input: 10,
      output: 2,
      cacheRead: 3,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
    });
    const report = summarize([
      sample({
        arm: "orchestrated",
        classifierUsage: usage,
        calls: [
          {
            id: "one",
            name: "mcp__chrome_devtools__list_console_messages",
            durationMs: 1,
            error: false,
          },
          {
            id: "two",
            parent: "wrapper",
            name: "mcp__chrome_devtools__take_snapshot",
            durationMs: 1,
            error: false,
          },
        ],
      }),
    ]);
    expect(report.groups[0]).toMatchObject({
      classifierTokens: 15,
      missingUsageCalls: 1,
      reportedCostUsd: 0.3,
      nativeFallbackCalls: 1,
      medianNativeCalls: 2,
    });
  });

  test("bounds paid runs and rejects invalid or incomparable configurations", () => {
    expect(parseOptions(["--phase", "scripted", "--runs", "2", "--warmups", "0"]).runs).toBe(2);
    expect(
      parseOptions(["--phase", "agent", "--model", "test/luna", "--thinking", "high"]),
    ).toMatchObject({ provider: "test", model: "luna", thinking: "high" });
    expect(parseOptions(["--phase", "scripted"]).thinking).toBe("off");
    expect(() => parseOptions(["--thinking", "unsupported"])).toThrow("Invalid --thinking level");
    expect(() => parseOptions(["--runs", "0"])).toThrow();
    expect(() => parseOptions(["--runs", "1.5"])).toThrow();
    expect(() => parseOptions(["--runs", "31"])).toThrow();
    expect(() => parseOptions(["--phase", "scripted", "--cases", "diagnostics"])).toThrow();
    expect(() => parseOptions(["--cases", "form,form"])).toThrow();
    expect(() => parseOptions(["--unknown", "yes"])).toThrow();
    expect(() => parseOptions(["--model", "bad", "--phase", "agent"])).toThrow();
  });
});
