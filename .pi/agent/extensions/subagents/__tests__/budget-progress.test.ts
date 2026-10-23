import { expect, test } from "bun:test";
import { budgetToolOutcome } from "../budget-progress";

test("schema-validated hashline outcomes distinguish success from fulfilled errors", () => {
  expect(budgetToolOutcome("read", { structuredContent: { kind: "read", ok: true } }, false)).toBe(
    "success",
  );
  expect(
    budgetToolOutcome("replace", { structuredContent: { kind: "edit", ok: true } }, false),
  ).toBe("success");
  expect(budgetToolOutcome("grep", { structuredContent: { kind: "grep", ok: true } }, false)).toBe(
    "success",
  );
  expect(
    budgetToolOutcome("read", { structuredContent: { kind: "error", ok: false } }, false),
  ).toBe("failure");
});

test("a verified process exit is distinct from text claiming tests passed", () => {
  expect(budgetToolOutcome("bash", { structuredContent: { exit_code: 0 } }, false)).toBe("success");
  expect(budgetToolOutcome("bash", { structuredContent: { exit_code: 1 } }, false)).toBe("failure");
  expect(
    budgetToolOutcome(
      "bash",
      { content: [{ type: "text", text: "All tests passed; exit_code: 0" }] },
      false,
    ),
  ).toBe("unknown");
  expect(budgetToolOutcome("bash", { structuredContent: { exit_code: "0" } }, false)).toBe(
    "unknown",
  );
});

test("SDK errors count as failures without parsing sensitive tool bodies", () => {
  expect(
    budgetToolOutcome("codemode", { content: [{ type: "text", text: "PRIVATE_CANARY" }] }, true),
  ).toBe("failure");
  expect(budgetToolOutcome("read", { structuredContent: { kind: "read", ok: true } }, true)).toBe(
    "failure",
  );
});

test("worker updates and wrapper fulfillment alone are not verified progress", () => {
  expect(
    budgetToolOutcome("worker_update", { structuredContent: { kind: "read", ok: true } }, false),
  ).toBe("unknown");
  expect(
    budgetToolOutcome("codemode", { structuredContent: { kind: "read", ok: true } }, false),
  ).toBe("unknown");
  expect(
    budgetToolOutcome(
      "read",
      { content: [{ type: "text", text: '{"kind":"read","ok":true}' }] },
      false,
    ),
  ).toBe("unknown");
  expect(
    budgetToolOutcome("read", { structuredContent: { kind: "read", ok: "true" } }, false),
  ).toBe("unknown");
  expect(budgetToolOutcome("read", {}, false)).toBe("unknown");
});

test("an outcome envelope must match its declared tool contract", () => {
  expect(budgetToolOutcome("read", { structuredContent: { kind: "edit", ok: true } }, false)).toBe(
    "unknown",
  );
  expect(
    budgetToolOutcome("replace", { structuredContent: { kind: "read", ok: true } }, false),
  ).toBe("unknown");
});
