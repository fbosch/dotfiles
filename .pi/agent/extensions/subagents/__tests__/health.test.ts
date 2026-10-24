import { expect, test } from "bun:test";
import { processCleanupHealth } from "../health";

test("cleanup uncertainty and ownership survive replacement health clients", () => {
  const processScope = {};
  const first = processCleanupHealth(processScope);
  expect(first.isBlocked()).toBe(false);
  first.retain("worker", [{ allocated: true }]);
  first.markUncertain({
    parentSessionId: "parent",
    workerId: "worker",
    assignmentId: "assignment",
    diagnostic: "Tool did not settle",
  });
  const reloaded = processCleanupHealth(processScope);
  expect(reloaded.isBlocked()).toBe(true);
  expect(reloaded.diagnostics()[0]?.diagnostic).toBe("Tool did not settle");
  expect(processCleanupHealth({}).isBlocked()).toBe(false);
});
