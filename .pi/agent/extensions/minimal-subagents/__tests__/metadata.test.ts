import { expect, test } from "bun:test";
import { workerMetadata } from "../metadata";
import { restoreHistory, HISTORY_ENTRY } from "../history";
import type { WorkerSnapshot } from "../owner";

const worker: WorkerSnapshot = {
  id: "worker-id", specialist: "quick", parentSessionId: "parent", createdAt: 0, status: "idle", liveSession: "available", currentAssignmentId: "assignment",
  config: { name: "quick", description: "Fixture", prompt: "Role", model: "presets/routine", thinking: "high", maxTurns: 2, tools: [], excludeTools: [], extensions: [], skills: [] },
  assignments: [{ id: "assignment", prompt: "Task", outcome: "completed", maxTurns: 2, turnsUsed: 1, remainingTurns: 1, persistence: "saved", transcript: [] }],
};
const observation = { startedAt: 0, endedAt: 5574, activity: "Settled", liveText: "", inputTokens: 271, outputTokens: 6, cost: 0.00009538, resolvedModel: "provider/physical-model", resolvedThinking: "low" as const };

test("metadata groups outcome and measured metrics with the runtime-resolved preset", () => {
  expect(workerMetadata(worker, observation)).toEqual([
    "Completed · Ready to continue", "", "Model      presets/routine → provider/physical-model", "Thinking   low", "Duration   5.6 s", "Turns      1 / 2", "Tokens     271 input · 6 output", "Cost       0.00009538",
  ]);
  const details = workerMetadata(worker, observation, true).join("\n");
  expect(details).toContain("Worker ID  worker-id");
  expect(details).toContain("Started    1970-01-01T00:00:00.000Z");
  expect(details).toContain("State      idle · available");
});

test("pending resolution omits thinking instead of presenting the configured alias level as resolved", () => {
  const rows = workerMetadata(worker);
  expect(rows).toContain("Model      presets/routine");
  expect(rows.some((row) => row.startsWith("Thinking"))).toBe(false);
  expect(rows).toContain("Tokens     — input · — output");
  expect(workerMetadata(worker, { startedAt: 0, activity: "Settled", liveText: "", inputTokens: 0, outputTokens: 0, cost: 0 })).toContain("Cost       0");
});

test("saved observations retain runtime resolution and older observations remain readable", () => {
  const entry = { type: "custom", customType: HISTORY_ENTRY, data: { version: 1, worker, observation } };
  const restored = restoreHistory([JSON.parse(JSON.stringify(entry))], "parent");
  expect(restored[0]?.observation?.resolvedModel).toBe("provider/physical-model");
  expect(restored[0]?.observation?.resolvedThinking).toBe("low");
  const old = { ...entry, data: { ...entry.data, observation: { startedAt: 0, activity: "Settled", liveText: "" } } };
  expect(restoreHistory([old], "parent")).toHaveLength(1);
});

test("runtime metadata cannot inject terminal controls or rows", () => {
  const rows = workerMetadata(worker, { ...observation, resolvedModel: "provider/æ\nø\u001b[31må" });
  expect(rows).toContain("Model      presets/routine → provider/æ øå");
});
