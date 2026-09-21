import { describe, expect, test } from "bun:test";
import { runWithHostedPacing } from "../skill-selection-offline";

describe("hosted benchmark pacing", () => {
  test("waits only between actual hosted calls, including across runs", async () => {
    const waits: number[] = [];
    const requests: number[] = [];
    const cases = [
      { explicitSkillInvocation: true },
      {},
      {},
      { explicitSkillInvocation: true },
      {},
    ];

    const first = await runWithHostedPacing(
      cases.slice(0, 3),
      1000,
      async (index) => {
        requests.push(index);
        return index;
      },
      async (delay) => {
        waits.push(delay);
      },
    );
    const second = await runWithHostedPacing(
      cases.slice(3),
      1000,
      async (index) => {
        requests.push(index + 3);
        return index;
      },
      async (delay) => {
        waits.push(delay);
      },
      first.hostedCalls,
    );

    expect(first.results).toEqual([0, 1, 2]);
    expect(second.results).toEqual([0, 1]);
    expect(requests).toEqual([0, 1, 2, 3, 4]);
    expect(waits).toEqual([1000, 1000]);
  });

  test("does not wait for zero-delay or offline-only cases", async () => {
    const waits: number[] = [];
    const result = await runWithHostedPacing(
      [{ explicitSkillInvocation: true }, { explicitSkillInvocation: true }],
      0,
      async (index) => index,
      async (delay) => {
        waits.push(delay);
      },
    );

    expect(result.results).toEqual([0, 1]);
    expect(result.hostedCalls).toBe(0);
    expect(waits).toEqual([]);
  });
});
