import { expect, test } from "bun:test";
import {
  AssignmentBudget,
  type BudgetAdviceInput,
  type BudgetAdvisor,
} from "../../extensions/subagents/budget";
import { type ChildDriver, WorkerOwner } from "../../extensions/subagents/owner";
import { createTrialBudget } from "../subagent-budget-trial";

test("scripted reference grants at running admission without a classifier or manual extension", async () => {
  let classifierCalls = 0;
  const inputs: BudgetAdviceInput[] = [];
  const advisor: BudgetAdvisor = async () => {
    classifierCalls++;
    return { kind: "unavailable", reason: "unsupported" };
  };
  let owner: WorkerOwner;
  const driver: ChildDriver = {
    async start(input, callbacks) {
      expect(owner.inspect(input.workerId).status).toBe("running");
      await expect(owner.extendBudget(input.workerId, input.assignmentId, 4)).rejects.toThrow(
        "Cannot extend assignment budget in running state",
      );
      const admit = callbacks.onBeforeModel;
      if (!admit) throw new Error("Fixture admission callback is unavailable");
      for (let turn = 1; turn <= 8; turn++) {
        const admission = await admit();
        expect(admission.admitted).toBe(true);
        expect(admission.maxTurns).toBe(turn <= 2 ? 4 : 8);
        callbacks.onTurn(turn);
        callbacks.onToolOutcome?.("success");
      }
      expect(await admit()).toEqual({ admitted: false, maxTurns: 8 });
      return { kind: "budget-exhausted", turnsUsed: 8, partialReport: "Reference fixture" };
    },
    async prompt() {
      throw new Error("Fixture does not continue");
    },
    async steer() {},
    async abort() {},
    async close() {
      return { confirmed: true };
    },
  };
  owner = new WorkerOwner({
    parentSessionId: "scripted-reference-fixture",
    persistence: { async save() {} },
    cleanupHealth: { isBlocked: () => false, markUncertain() {} },
    driver,
    budget: createTrialBudget("reference", advisor, (input) => inputs.push(input)),
  });
  try {
    const launch = await owner.launch({
      config: {
        name: "fixture",
        description: "Scripted reference fixture",
        prompt: "Fixture only",
        model: "fixture/fixture",
        maxTurns: 4,
        hardMaxTurns: 8,
        tools: [],
        excludeTools: [],
        extensions: [],
        skills: [],
      },
      prompt: "Fixture only",
      maxTurns: 4,
    });
    const result = await owner.wait(launch.workerId, launch.assignmentId, { timeoutMs: 5_000 });
    expect(result.kind).toBe("budget-exhausted");
    const assignment = owner.inspect(launch.workerId).assignments[0];
    expect(assignment?.outcome).toBe("budget-exhausted");
    expect(assignment?.turnsUsed).toBe(8);
    expect(assignment?.budget).toMatchObject({
      initialTurns: 4,
      grantedTurns: 8,
      hardMaxTurns: 8,
      mode: "automatic",
      automaticGrants: 1,
      checks: 1,
    });
    expect(assignment?.budget?.decisions).toEqual([
      expect.objectContaining({ turnsUsed: 2, kind: "granted", grantedTurns: 4, probability: 1 }),
    ]);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ turnsUsed: 2, grantedTurns: 4, automaticGrants: 0 });
    expect(classifierCalls).toBe(0);
  } finally {
    await owner.shutdown();
  }
});

for (const arm of ["fixed", "advisory"] as const) {
  test(`${arm} remains non-granting with productive advice`, async () => {
    let classifierCalls = 0;
    const inputs: BudgetAdviceInput[] = [];
    const budget = new AssignmentBudget(4, {
      ...createTrialBudget(
        arm,
        async () => {
          classifierCalls++;
          return { kind: "judgment", probability: 1 };
        },
        (input) => inputs.push(input),
      ),
      hardMaxTurns: 8,
    });
    budget.observe("success");
    expect((await budget.beforeModel(3, () => true)).maxTurns).toBe(4);
    expect(budget.snapshot()?.automaticGrants).toBe(0);
    expect(classifierCalls).toBe(arm === "fixed" ? 0 : 1);
    expect(inputs).toHaveLength(classifierCalls);
  });
}

for (const outcomes of [["unknown"], ["success", "failure", "failure"]] as const) {
  test(`scripted reference preserves the evidence gate for ${outcomes.join("/")}`, async () => {
    const budget = new AssignmentBudget(4, {
      ...createTrialBudget(
        "reference",
        async () => {
          throw new Error("Reference must not dispatch a classifier");
        },
        () => {},
      ),
      hardMaxTurns: 8,
    });
    for (const outcome of outcomes) budget.observe(outcome);
    const admission = await budget.beforeModel(3, () => true);
    expect(admission.maxTurns).toBe(4);
    expect(admission.decision).toMatchObject({ reason: "insufficient-evidence", grantedTurns: 0 });
    expect(budget.snapshot()?.automaticGrants).toBe(0);
  });
}
