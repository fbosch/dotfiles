import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkerDelivery } from "../delivery";
import { WorkerOwner, type ChildDriver, type ChildDriverCallbacks, type ChildExecutionOutcome, type ChildRunInput } from "../owner";
import { ParentRuntime } from "../parent-runtime";
import { resolveSpecialist } from "../specialist";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const done: ChildExecutionOutcome = { kind: "completed", turnsUsed: 1, report: "Complete report" };
async function fixture(immediate = false) {
  const directory = await mkdtemp(join(tmpdir(), "pi-parent-runtime-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const baseline = join(directory, "baseline.ts");
  await writeFile(baseline, "export default function () {}\n");
  const runs = new Map<string, { input: ChildRunInput; callbacks: ChildDriverCallbacks; finish: (outcome: ChildExecutionOutcome) => void }>();
  const inputs: ChildRunInput[] = [];
  const driver: ChildDriver = {
    start(input, callbacks) {
      inputs.push(input);
      if (immediate) return Promise.resolve(done);
      return new Promise((finish) => { runs.set(input.workerId, { input, callbacks, finish }); });
    },
    prompt(input, callbacks) { return this.start(input, callbacks); },
    async steer() {},
    async abort(id) { runs.get(id)?.finish({ kind: "failed", turnsUsed: 0, error: "Aborted" }); },
    async close() { return { confirmed: true }; },
  };
  const owner = new WorkerOwner({ parentSessionId: "parent", driver, persistence: { async save() {} }, cleanupHealth: { isBlocked: () => false, markUncertain() {} } });
  const errors: unknown[] = [];
  const delivery = new WorkerDelivery(owner, () => {}, (error) => { errors.push(error); });
  let resolutions = 0;
  const runtime = new ParentRuntime(delivery, {
    async resolve(name, overrides) {
      resolutions++;
      return resolveSpecialist(name, "---\ndescription: Fixture\nmodel: fixture/model\ntools: [read]\nbundles: []\nskills: []\nmax_turns: 12\n---\nFixture role", {
        baseline: { extensions: [baseline] }, bundles: new Map(), skills: new Map(), availableModels: new Set(["fixture/model"]),
      }, overrides);
    },
    messages: () => [
      { role: "user", content: [{ type: "text", text: "PARENT_TEXT" }, { type: "image", data: "IMAGE_PAYLOAD" }] },
      { role: "toolResult", content: "TOOL_EVIDENCE" },
      { role: "compactionSummary", summary: "PARENT_SUMMARY" },
    ],
  });
  cleanups.push(() => runtime.shutdown());
  return { runtime, owner, inputs, runs, errors, baseline, resolutions: () => resolutions };
}
function launched(result: Awaited<ReturnType<ParentRuntime["launch"]>>) {
  if (result.kind !== "launched") throw new Error("Expected background launch");
  return result;
}

test("shared launch resolves the specialist and supports background and foreground results", async () => {
  const f = await fixture(true);
  const background = launched(await f.runtime.launch({ specialist: "fixture", prompt: "Task" }));
  expect(background.workerId).toBeTruthy();
  const foreground = await f.runtime.launch({ specialist: "fixture", prompt: "Task", foreground: true });
  expect(foreground).toMatchObject({ kind: "completed", report: "Complete report" });
  expect(f.resolutions()).toBe(2);
  expect(f.inputs.every((input) => input.config.name === "fixture")).toBe(true);
  expect(f.errors).toEqual([]);
});

test("fresh launch excludes parent context while optional inheritance uses narrative text only", async () => {
  const f = await fixture(true);
  await f.runtime.launch({ specialist: "fixture", prompt: "Fresh" });
  await f.runtime.launch({ specialist: "fixture", prompt: "Inherited", inheritContext: true });
  expect(f.inputs[0]?.prompt).toBe("Fresh");
  expect(f.inputs[1]?.prompt).toContain("PARENT_TEXT");
  expect(f.inputs[1]?.prompt).toContain("PARENT_SUMMARY");
  expect(f.inputs[1]?.prompt).not.toContain("IMAGE_PAYLOAD");
  expect(f.inputs[1]?.prompt).not.toContain("TOOL_EVIDENCE");
});

test("preflight failure and interruption do not allocate workers", async () => {
  const f = await fixture();
  await expect(f.runtime.launch({ specialist: "fixture", prompt: "Task", model: "fixture/other" })).rejects.toThrow("override");
  const controller = new AbortController();
  controller.abort();
  await expect(f.runtime.launch({ specialist: "fixture", prompt: "Task" }, controller.signal)).rejects.toThrow("interrupted");
  expect(f.owner.list()).toEqual([]);
  expect(f.inputs).toEqual([]);
});

test("shared control cancels queued work without starting it and rejects foreign or stale IDs", async () => {
  const f = await fixture();
  const launches = [];
  for (let i = 0; i < 7; i++) launches.push(launched(await f.runtime.launch({ specialist: "fixture", prompt: `Task ${i}` })));
  const queued = launches[6]!;
  expect(f.inputs).toHaveLength(6);
  expect(f.runtime.inspect({ mode: "status", workerId: queued.workerId })).toMatchObject({ state: "queued" });
  await f.runtime.control({ action: "cancel", workerId: queued.workerId });
  expect(f.inputs).toHaveLength(6);
  await expect(f.runtime.control({ action: "steer", workerId: launches[0]!.workerId, assignmentId: "stale", text: "Change scope" })).rejects.toThrow("non-current");
  await expect(f.runtime.control({ action: "cancel", workerId: "foreign" })).rejects.toThrow();
  expect(() => f.runtime.inspect({ mode: "report", workerId: "foreign" })).toThrow();
});

test("continuation retains resolved configuration instead of reloading changed specialist resources", async () => {
  const f = await fixture(true);
  const first = launched(await f.runtime.launch({ specialist: "fixture", prompt: "First" }));
  await f.runtime.inspect({ mode: "wait", workerId: first.workerId, assignmentId: first.assignmentId });
  await rm(f.baseline);
  const continuation = await f.runtime.control({ action: "continue", workerId: first.workerId, prompt: "Follow-up", maxTurns: 3 });
  expect(continuation).toMatchObject({ kind: "launched", workerId: first.workerId });
  expect(f.resolutions()).toBe(1);
  expect(f.inputs[1]?.config).toEqual(f.inputs[0]?.config);
  expect(f.inputs[1]?.turnBudget).toBe(3);
});
