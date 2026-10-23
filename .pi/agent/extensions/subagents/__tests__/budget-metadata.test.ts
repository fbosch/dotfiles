import { expect, test } from "bun:test";
import { AssignmentBudget } from "../budget";
import { budgetMetadata } from "../budget-metadata";

const tui: typeof import("@earendil-works/pi-tui") = await import(
  process.env.PI_SUBAGENT_TEST_TUI ?? "@earendil-works/pi-tui"
);
async function fixture(mode: "advisory" | "automatic") {
  const budget = new AssignmentBudget(16, {
    hardMaxTurns: 24,
    mode,
    confidenceThreshold: 0.9,
    advisor: async () => ({
      kind: "judgment",
      probability: 0.99,
      usage: { provider: "fixture", providerAttempts: 1 },
    }),
  });
  budget.observe("success");
  await budget.beforeModel(15, () => true);
  return budget;
}

test("details distinguish an applied grant from advisory evaluation", async () => {
  const applied = await fixture("automatic");
  const rows = budgetMetadata(applied.snapshot(), applied.maxTurns);
  expect(rows).toContainEqual(["Initial", "16"]);
  expect(rows).toContainEqual(["Granted", "20"]);
  expect(rows).toContainEqual(["Ceiling", "24"]);
  expect(rows).toContainEqual(["Decision", "Applied +4 · revision 0"]);
  const advisory = await fixture("advisory");
  const advice = budgetMetadata(advisory.snapshot(), advisory.maxTurns);
  expect(advice).toContainEqual(["Granted", "16"]);
  expect(advice).toContainEqual(["Decision", "Advisory · candidate +4 · no grant · revision 0"]);
});

test("unreported classifier metrics and historical facts remain unavailable", async () => {
  const budget = await fixture("automatic");
  const rows = budgetMetadata(budget.snapshot(), budget.maxTurns);
  expect(rows).toContainEqual(["Cls tokens", "— input · — output"]);
  expect(rows).toContainEqual(["Cls cost", "—"]);
  const older = budgetMetadata(undefined, 16);
  expect(older).toContainEqual(["Granted", "16"]);
  expect(older).toContainEqual(["Initial", "—"]);
  expect(older).toContainEqual(["Ceiling", "—"]);
});

test("detail text fits the same TUI text component at narrow widths", async () => {
  const budget = await fixture("automatic");
  for (const width of [8, 24, 80]) {
    for (const [name, value] of budgetMetadata(budget.snapshot(), budget.maxTurns)) {
      for (const line of new tui.Text(`${name.padEnd(10)} ${value}`, 0, 0).render(width)) {
        expect(tui.visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  }
});

test("repeated inspection does not request advice or mutate budget counters", () => {
  let calls = 0;
  const budget = new AssignmentBudget(16, {
    hardMaxTurns: 24,
    advisor: async () => {
      calls++;
      return { kind: "judgment", probability: 1 };
    },
  });
  budget.observe("success");
  for (let i = 0; i < 5; i++) budgetMetadata(budget.snapshot(), budget.maxTurns);
  expect(calls).toBe(0);
  expect(budget.snapshot()).toMatchObject({ grantedTurns: 16, checks: 0, automaticGrants: 0 });
});
