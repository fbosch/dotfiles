import { describe, expect, test } from "bun:test";
import { replayGuard, summarizeReplay } from "../replay";

describe("actual command guard handler replay", () => {
  test("routes dangerous fixtures to denial, retaining the deliberate scope exemption", async () => {
    const rows = await replayGuard();
    const summary = summarizeReplay(rows);
    expect(summary.dangerousAllowed).toEqual([]);
    // The granted-path delete plus the two opaque scripts delegated to nono.
    expect(summary.scopeExemptions).toBe(3);
    expect(summary.unnecessaryPrompts).toBe(0);
    expect(summary.failures).toBe(0);
    for (const id of ["script", "inline-delete"]) {
      expect(rows.find((row) => row.fixture === id)).toMatchObject({
        route: "skip",
        requests: 0,
        prompts: 0,
        blocked: false,
      });
    }
    expect(rows.find((row) => row.fixture === "substitution")).toMatchObject({
      route: "review",
      requests: 1,
      blocked: true,
    });
    expect(rows.find((row) => row.fixture === "hard-block")).toMatchObject({
      requests: 0,
      prompts: 0,
      blocked: true,
    });
    expect(rows.find((row) => row.fixture === "granted-delete")).toMatchObject({
      requests: 0,
      prompts: 0,
      blocked: false,
    });
  });

  test("counts low-score escapes, model attribution, and request failures separately", async () => {
    const clear = await replayGuard({
      request: async () => ({
        ok: true,
        value: {
          answers: {
            destructive: { type: "bool", probability: 0.01 },
            exfiltration: { type: "bool", probability: 0.01 },
          },
        },
      }),
      takeModels: () => ["provider/model"],
    });
    const summary = summarizeReplay(clear);
    expect(summary.dangerousAllowed).toContain("find-delete");
    expect(summary.byModel["provider/model"]?.dangerousAllowed).toBeGreaterThan(0);
    const failed = await replayGuard({
      request: async () => ({ ok: false, stage: "request", reason: "timeout" }),
    });
    expect(summarizeReplay(failed).dangerousAllowed).toEqual([]);
    expect(summarizeReplay(failed).failures).toBeGreaterThan(0);
  });

  test("headless replay fails closed without opening dialogs", async () => {
    const rows = await replayGuard({ hasUI: false });
    expect(summarizeReplay(rows).dangerousAllowed).toEqual([]);
    expect(rows.every((row) => row.prompts === 0)).toBe(true);
  });
});
