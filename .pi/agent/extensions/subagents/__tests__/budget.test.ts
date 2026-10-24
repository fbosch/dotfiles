import { expect, test } from "bun:test";
import {
  AssignmentBudget,
  assignmentCeiling,
  type BudgetAdvice,
  type BudgetAdvisor,
} from "../budget";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const productive: BudgetAdvisor = async () => ({ kind: "judgment", probability: 0.99 });
function automatic(hardMaxTurns = 30, advisor: BudgetAdvisor = productive) {
  const budget = new AssignmentBudget(16, {
    hardMaxTurns,
    mode: "automatic",
    confidenceThreshold: 0.9,
    advisor,
  });
  budget.observe("success");
  return budget;
}

test("fixed operation needs neither classifier setup nor an inferred ceiling", async () => {
  let calls = 0;
  const budget = new AssignmentBudget(2, {
    advisor: async () => {
      calls++;
      return { kind: "judgment", probability: 1 };
    },
  });
  budget.observe("unknown");
  expect(await budget.beforeModel(1, () => true)).toEqual({ maxTurns: 2 });
  budget.extend(2);
  expect(budget.maxTurns).toBe(4);
  expect(calls).toBe(0);
  expect(budget.snapshot()).toMatchObject({ initialTurns: 2, grantedTurns: 4, checks: 0 });
});

test("ceilings accept equal or lowered overrides but reject expanded or unsafe limits", () => {
  expect(assignmentCeiling(16, 24, 24)).toBe(24);
  expect(assignmentCeiling(16, 24, 20)).toBe(20);
  expect(assignmentCeiling(16)).toBeUndefined();
  for (const resolve of [
    () => assignmentCeiling(16, 24, 25),
    () => assignmentCeiling(16, undefined, 24),
    () => assignmentCeiling(16, 24, 15),
    () => assignmentCeiling(25, 24),
    () => assignmentCeiling(0),
    () => assignmentCeiling(Number.MAX_SAFE_INTEGER + 1),
    () => assignmentCeiling(16, Number.POSITIVE_INFINITY),
  ])
    expect(resolve).toThrow();
});

test("usable advisory checks do not spend extra turns", async () => {
  const budget = new AssignmentBudget(16, { hardMaxTurns: 24, advisor: productive });
  budget.observe("success");
  const result = await budget.beforeModel(15, () => true);
  expect(result.maxTurns).toBe(16);
  expect(result.decision).toMatchObject({
    kind: "advised",
    proposedTurns: 4,
    grantedTurns: 0,
    probability: 0.99,
  });
  expect(budget.snapshot()).toMatchObject({ automaticGrants: 0, checks: 1 });
});

test.each([
  ["automatic", 0.9, "success", 0.9, "granted", "productive"],
  ["automatic", 0.9, "success", 0.5, "wrap-up", "insufficient-confidence"],
  ["automatic", 0.9, "unknown", 0.5, "wrap-up", "insufficient-evidence"],
  ["automatic", undefined, "unknown", 1, "advised", "automatic-not-ready"],
  ["advisory", 0.9, "unknown", 1, "advised", "advisory"],
] as const)(
  "%s budget with threshold %s, %s progress, and probability %s records %s / %s",
  async (mode, confidenceThreshold, outcome, probability, kind, reason) => {
    const budget = new AssignmentBudget(16, {
      mode,
      hardMaxTurns: 24,
      ...(confidenceThreshold === undefined ? {} : { confidenceThreshold }),
      advisor: async () => ({ kind: "judgment", probability }),
    });
    budget.observe(outcome);
    const result = await budget.beforeModel(15, () => true);
    const granted = kind === "granted";
    expect(result.maxTurns).toBe(granted ? 20 : 16);
    expect(result.decision).toMatchObject({
      kind,
      reason,
      probability,
      revision: 0,
      turnsUsed: 14,
      proposedTurns: 4,
      grantedTurns: granted ? 4 : 0,
    });
    expect(result.decision?.diagnostic).toBe(reason === "automatic-not-ready" ? true : undefined);
    expect(budget.snapshot()).toMatchObject({
      grantedTurns: result.maxTurns,
      automaticGrants: granted ? 1 : 0,
      revision: granted ? 1 : 0,
      checks: 1,
      decisions: [result.decision],
    });
  },
);

test("unknown outcomes preserve a failure streak and success resets it", () => {
  const budget = new AssignmentBudget(16);
  for (const [outcome, consecutiveFailures] of [
    ["failure", 1],
    ["unknown", 1],
    ["failure", 2],
    ["success", 0],
    ["unknown", 0],
  ] as const) {
    budget.observe(outcome);
    expect(budget.snapshot()?.progress.consecutiveFailures).toBe(consecutiveFailures);
  }
  expect(budget.snapshot()?.progress).toEqual({
    completedTools: 5,
    verifiedSuccesses: 1,
    failures: 2,
    unknownOutcomes: 2,
    consecutiveFailures: 0,
  });
});

test("two automatic increments are bounded even when the ceiling has more space", async () => {
  const budget = automatic();
  expect((await budget.beforeModel(15, () => true)).maxTurns).toBe(20);
  expect((await budget.beforeModel(19, () => true)).maxTurns).toBe(24);
  expect((await budget.beforeModel(23, () => true)).maxTurns).toBe(24);
  expect(budget.snapshot()).toMatchObject({
    grantedTurns: 24,
    hardMaxTurns: 30,
    automaticGrants: 2,
    checks: 2,
    revision: 2,
  });
});

test("the final increment is clamped to the specialist ceiling", async () => {
  const budget = automatic(18);
  expect((await budget.beforeModel(15, () => true)).maxTurns).toBe(18);
  expect(() => budget.extend(1)).toThrow("ceiling");
  expect((await budget.beforeModel(17, () => true)).maxTurns).toBe(18);
  expect(budget.snapshot()?.automaticGrants).toBe(1);
});

test("manual extensions preserve consumed automatic and check capacity", async () => {
  const budget = automatic(40);
  await budget.beforeModel(15, () => true);
  budget.extend(4);
  await budget.beforeModel(23, () => true);
  budget.extend(4);
  expect((await budget.beforeModel(31, () => true)).maxTurns).toBe(32);
  expect(budget.snapshot()).toMatchObject({ automaticGrants: 2, checks: 2 });
});

test("repeated observations share one pending decision and no duplicate grant", async () => {
  const pending = deferred<BudgetAdvice>();
  let calls = 0;
  const budget = automatic(24, async () => {
    calls++;
    return pending.promise;
  });
  const first = budget.beforeModel(15, () => true);
  const second = budget.beforeModel(15, () => true);
  expect(first).toBe(second);
  await Promise.resolve();
  pending.resolve({ kind: "judgment", probability: 1 });
  await Promise.all([first, second]);
  expect(calls).toBe(1);
  expect(budget.snapshot()).toMatchObject({ automaticGrants: 1, checks: 1 });
});

test("cancellation settles a check even when the advisor ignores its abort signal", async () => {
  const pending = deferred<BudgetAdvice>();
  const budget = automatic(24, async () => pending.promise);
  const check = budget.beforeModel(15, () => true);
  budget.invalidate();
  expect((await check).maxTurns).toBe(16);
  pending.resolve({ kind: "judgment", probability: 1 });
  await Promise.resolve();
  expect(budget.snapshot()).toMatchObject({
    grantedTurns: 16,
    automaticGrants: 0,
    checks: 1,
    decisions: [],
  });
});

test("a changed allowance invalidates advice from its prior revision", async () => {
  const pending = deferred<BudgetAdvice>();
  const budget = automatic(30, async () => pending.promise);
  const check = budget.beforeModel(15, () => true);
  budget.extend(2);
  pending.resolve({ kind: "judgment", probability: 1 });
  expect((await check).maxTurns).toBe(18);
  expect(budget.snapshot()).toMatchObject({
    grantedTurns: 18,
    revision: 1,
    automaticGrants: 0,
    checks: 1,
    decisions: [],
  });
});

test("a lost lifecycle predicate discards otherwise productive advice", async () => {
  const pending = deferred<BudgetAdvice>();
  const budget = automatic(24, async () => pending.promise);
  let current = true;
  const check = budget.beforeModel(15, () => current);
  current = false;
  pending.resolve({ kind: "judgment", probability: 1 });
  expect((await check).maxTurns).toBe(16);
  expect(budget.snapshot()?.automaticGrants).toBe(0);
});

test("a timeout retains the allowance and cannot retry the same revision", async () => {
  let calls = 0;
  const budget = new AssignmentBudget(16, {
    hardMaxTurns: 24,
    mode: "automatic",
    confidenceThreshold: 0.9,
    timeoutMs: 5,
    advisor: async () => {
      calls++;
      return new Promise<BudgetAdvice>(() => {});
    },
  });
  budget.observe("success");
  const first = await budget.beforeModel(15, () => true);
  expect(first.decision).toMatchObject({ kind: "unavailable", reason: "timeout", grantedTurns: 0 });
  expect((await budget.beforeModel(16, () => true)).maxTurns).toBe(16);
  expect(calls).toBe(1);
});

test("invalid probability and insufficient confidence never grant turns", async () => {
  for (const probability of [Number.NaN, -1, 2, 0.5]) {
    const budget = automatic(24, async () => ({ kind: "judgment", probability }));
    const result = await budget.beforeModel(15, () => true);
    expect(result.maxTurns).toBe(16);
    expect(result.decision?.grantedTurns).toBe(0);
  }
});

test("unknown progress is not a fabricated verified success", () => {
  const budget = automatic();
  budget.observe("failure");
  budget.observe("unknown");
  expect(budget.snapshot()?.progress).toMatchObject({
    completedTools: 3,
    verifiedSuccesses: 1,
    failures: 1,
    unknownOutcomes: 1,
    consecutiveFailures: 1,
  });
});

test("advisory checks remain bounded across explicit manual extensions", async () => {
  let calls = 0;
  const budget = new AssignmentBudget(16, {
    hardMaxTurns: 32,
    advisor: async () => {
      calls++;
      return { kind: "judgment", probability: 1 };
    },
  });
  budget.observe("unknown");
  await budget.beforeModel(15, () => true);
  budget.extend(4);
  await budget.beforeModel(19, () => true);
  budget.extend(4);
  await budget.beforeModel(23, () => true);
  expect(calls).toBe(2);
  expect(budget.snapshot()).toMatchObject({ grantedTurns: 24, checks: 2, automaticGrants: 0 });
});

test("historical allowances stay read-only without inventing adaptive evidence", async () => {
  const budget = AssignmentBudget.fromHistory(16);
  expect(budget.snapshot()).toBeUndefined();
  expect(budget.maxTurns).toBe(16);
  expect(() => budget.extend(1)).toThrow("read-only");
  expect(await budget.beforeModel(15, () => true)).toEqual({ maxTurns: 16 });
});

test("short assignments and metadata without progress do not gain hidden reserve turns", async () => {
  const budget = new AssignmentBudget(1, {
    hardMaxTurns: 8,
    advisor: productive,
    mode: "automatic",
    confidenceThreshold: 0.9,
  });
  expect(await budget.beforeModel(1, () => true)).toEqual({ maxTurns: 1 });
  expect(budget.snapshot()).toMatchObject({ grantedTurns: 1, checks: 0, automaticGrants: 0 });
});

test("automatic mode without a reviewed threshold is disclosed and non-granting", async () => {
  const budget = new AssignmentBudget(16, {
    hardMaxTurns: 24,
    mode: "automatic",
    advisor: productive,
  });
  budget.observe("success");
  const result = await budget.beforeModel(15, () => true);
  expect(result.maxTurns).toBe(16);
  expect(result.decision).toMatchObject({
    kind: "advised",
    reason: "automatic-not-ready",
    diagnostic: true,
    grantedTurns: 0,
  });
});

test("unknown activity and repeated failures cannot become automatic progress proof", async () => {
  for (const outcomes of [["unknown"], ["success", "failure", "failure"]] as const) {
    const budget = new AssignmentBudget(16, {
      hardMaxTurns: 24,
      mode: "automatic",
      confidenceThreshold: 0,
      advisor: productive,
    });
    for (const outcome of outcomes) budget.observe(outcome);
    const result = await budget.beforeModel(15, () => true);
    expect(result.maxTurns).toBe(16);
    expect(result.decision).toMatchObject({
      kind: "wrap-up",
      reason: "insufficient-evidence",
      grantedTurns: 0,
    });
  }
});

test("assignment policy is detached from mutable caller options", async () => {
  const options = {
    hardMaxTurns: 24,
    mode: "automatic" as const,
    confidenceThreshold: 1,
    advisor: productive,
  };
  const budget = new AssignmentBudget(16, options);
  budget.observe("success");
  options.confidenceThreshold = 0;
  expect((await budget.beforeModel(15, () => true)).maxTurns).toBe(16);
});

test("restored budget evidence is detached and deeply frozen", async () => {
  const live = automatic(24);
  await live.beforeModel(15, () => true);
  const snapshot = live.snapshot();
  if (!snapshot) throw new Error("Missing live budget snapshot");
  const source = {
    ...snapshot,
    progress: { ...snapshot.progress },
    decisions: snapshot.decisions.map((value) => ({ ...value })),
  };
  const restored = AssignmentBudget.fromHistory(snapshot.grantedTurns, source);
  source.progress.completedTools = 999;
  const sourceDecision = source.decisions[0];
  if (sourceDecision) sourceDecision.grantedTurns = 999;
  expect(restored.snapshot()?.progress.completedTools).toBe(1);
  expect(restored.snapshot()?.decisions[0]?.grantedTurns).toBe(4);
  expect(Object.isFrozen(restored.snapshot())).toBe(true);
  expect(Object.isFrozen(restored.snapshot()?.progress)).toBe(true);
  expect(Object.isFrozen(restored.snapshot()?.decisions)).toBe(true);
  expect(Object.isFrozen(restored.snapshot()?.decisions[0])).toBe(true);
  expect((await restored.beforeModel(19, () => true)).maxTurns).toBe(20);
});
