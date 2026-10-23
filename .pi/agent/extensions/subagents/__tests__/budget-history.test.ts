import { afterEach, expect, test } from "bun:test";
import { appendFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssignmentBudget, type BudgetSnapshot } from "../budget";
import { HISTORY_ENTRY, parentHistory, restoreHistory } from "../history";
import { WorkerOwner, type WorkerSnapshot } from "../owner";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function budgetFixture() {
  const budget = new AssignmentBudget(16, {
    hardMaxTurns: 24,
    mode: "automatic",
    confidenceThreshold: 0.9,
    advisor: async () => ({
      kind: "judgment",
      probability: 0.99,
      usage: { provider: "fixture", providerAttempts: 1 },
    }),
  });
  budget.observe("success");
  await budget.beforeModel(15, () => true);
  const snapshot = budget.snapshot();
  if (!snapshot) throw new Error("Missing fixture budget");
  return snapshot;
}
function worker(budget?: BudgetSnapshot): WorkerSnapshot {
  const maxTurns = budget?.grantedTurns ?? 16;
  return {
    parentSessionId: "parent",
    id: "worker",
    specialist: "fixture",
    currentAssignmentId: "assignment",
    status: "idle",
    liveSession: "available",
    createdAt: 0,
    config: {
      name: "fixture",
      description: "Fixture",
      prompt: "Role",
      model: "fixture/model",
      maxTurns: 16,
      ...(budget?.hardMaxTurns === undefined ? {} : { hardMaxTurns: budget.hardMaxTurns }),
      tools: ["read"],
      excludeTools: ["subagent"],
      extensions: [],
      skills: [],
    },
    assignments: [
      {
        id: "assignment",
        prompt: "Fixture",
        outcome: "completed",
        maxTurns,
        turnsUsed: 16,
        remainingTurns: maxTurns - 16,
        persistence: "saved",
        report: "Full report",
        ...(budget === undefined ? {} : { budget }),
        transcript: [{ role: "tool", timestamp: 0, text: "Visible evidence DETAILS_PRESERVED" }],
      },
    ],
  };
}
function entry(snapshot: WorkerSnapshot) {
  return { type: "custom", customType: HISTORY_ENTRY, data: { version: 1, worker: snapshot } };
}

test("budget metadata and complete transcripts survive the existing persistence path", async () => {
  const snapshot = worker(await budgetFixture());
  const assignment = snapshot.assignments[0];
  if (!assignment) throw new Error("Missing assignment");
  const directory = await mkdtemp(join(tmpdir(), "pi-budget-history-"));
  directories.push(directory);
  const file = join(directory, "parent.jsonl");
  const persistence = parentHistory({
    parentSessionId: "parent",
    currentParentId: () => "parent",
    parentFile: () => file,
    observation: () => undefined,
    append(customType, data) {
      appendFileSync(file, `${JSON.stringify({ type: "custom", customType, data })}\n`);
    },
  });
  await persistence.save({
    worker: snapshot,
    parentSessionId: "parent",
    workerId: "worker",
    specialist: "fixture",
    assignment,
    transcript: assignment.transcript,
    savedAt: 0,
  });
  const decoded: unknown[] = (await readFile(file, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const restored = restoreHistory(decoded, "parent")[0]?.worker;
  expect(restored?.assignments[0]?.budget).toEqual(assignment.budget);
  expect(restored?.assignments[0]?.transcript[0]?.text).toBe("Visible evidence DETAILS_PRESERVED");
  expect(restored?.assignments[0]?.persistence).toBe("saved");
});

test("restored adaptive history stays inspectable without checks or executable workers", async () => {
  let executions = 0;
  let advice = 0;
  const snapshot = restoreHistory([entry(worker(await budgetFixture()))], "parent")[0]?.worker;
  if (!snapshot) throw new Error("Missing restored worker");
  const owner = new WorkerOwner({
    parentSessionId: "parent",
    historicalWorkers: [snapshot],
    driver: {
      async start() {
        executions++;
        return { kind: "completed", report: "Unexpected", turnsUsed: 1 };
      },
      async prompt() {
        executions++;
        return { kind: "completed", report: "Unexpected", turnsUsed: 1 };
      },
      async steer() {},
      async abort() {},
      async close() {
        return { confirmed: true };
      },
    },
    persistence: { async save() {} },
    cleanupHealth: { isBlocked: () => false, markUncertain() {} },
    budget: {
      mode: "automatic",
      confidenceThreshold: 0,
      advisor: async () => {
        advice++;
        return { kind: "judgment", probability: 1 };
      },
    },
  });
  expect(owner.inspect("worker").assignments[0]?.budget).toMatchObject({
    initialTurns: 16,
    grantedTurns: 20,
    hardMaxTurns: 24,
    automaticGrants: 1,
    checks: 1,
  });
  expect(owner.findStatus("worker")?.assignments[0]?.budget?.decisions[0]?.kind).toBe("granted");
  expect(owner.report("worker")).toBe("Full report");
  expect(owner.transcript("worker").entries[0]?.text).toBe("Visible evidence DETAILS_PRESERVED");
  await expect(owner.continue("worker", "Resume")).rejects.toThrow();
  expect(executions).toBe(0);
  expect(advice).toBe(0);
});

test("older histories preserve only the known allowance", () => {
  const restored = restoreHistory([entry(worker())], "parent")[0]?.worker;
  expect(restored?.assignments[0]?.maxTurns).toBe(16);
  expect(restored?.assignments[0]?.budget).toBeUndefined();
  expect(restored?.config.hardMaxTurns).toBeUndefined();
});

test("corrupt adaptive counters, ceilings, and applied decisions are rejected", async () => {
  const original = await budgetFixture();
  const bad = [
    { ...original, grantedTurns: 21 },
    { ...original, automaticGrants: 3 },
    { ...original, checks: 3 },
    { ...original, initialTurns: Number.MAX_SAFE_INTEGER + 1 },
    { ...original, hardMaxTurns: 19 },
    { ...original, progress: { ...original.progress, completedTools: 100 } },
    { ...original, decisions: original.decisions.map((value) => ({ ...value, grantedTurns: 0 })) },
  ];
  for (const budget of bad) {
    const snapshot = worker(original);
    const corrupted = {
      ...snapshot,
      assignments: snapshot.assignments.map((value) => ({ ...value, budget })),
    };
    expect(() => restoreHistory([entry(corrupted)], "parent")).toThrow("Invalid saved");
  }
});
