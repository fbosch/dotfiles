import { expect, test } from "bun:test";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { registerParentTools } from "../tools";

function schemas() {
  const registered = new Map<string, TSchema>();
  registerParentTools(
    {
      registerTool(tool) {
        registered.set(tool.name, tool.parameters);
      },
    },
    () => {
      throw new Error("Runtime must not be created during tool registration");
    },
  );
  return registered;
}

test("launch tool schema supports explicit foreground, text inheritance, and safe budgets", () => {
  const schema = schemas().get("subagent")!;
  expect(
    Value.Check(schema, {
      specialist: "review",
      prompt: "Review the change",
      foreground: true,
      inheritContext: true,
      maxTurns: 3,
    }),
  ).toBe(true);
  expect(Value.Check(schema, { specialist: "review", prompt: "Review", maxTurns: 0 })).toBe(false);
  expect(
    Value.Check(schema, {
      specialist: "review",
      prompt: "Review",
      maxTurns: Number.MAX_SAFE_INTEGER + 1,
    }),
  ).toBe(false);
  expect(Value.Check(schema, { specialist: "review" })).toBe(false);
});

test("inspection schema distinguishes lightweight status, report retrieval, and bounded transcript pages", () => {
  const schema = schemas().get("subagent_result")!;
  expect(Value.Check(schema, { request: { mode: "status" } })).toBe(true);
  expect(Value.Check(schema, { request: { mode: "report", workerId: "worker" } })).toBe(true);
  expect(
    Value.Check(schema, {
      request: { mode: "transcript", workerId: "worker", offset: 2, limit: 500 },
    }),
  ).toBe(true);
  expect(
    Value.Check(schema, { request: { mode: "transcript", workerId: "worker", limit: 501 } }),
  ).toBe(false);
  expect(Value.Check(schema, { request: { mode: "wait", workerId: "worker" } })).toBe(false);
});

test("control schema requires question and assignment correlation and positive budget extensions", () => {
  const schema = schemas().get("subagent_control")!;
  expect(
    Value.Check(schema, {
      request: {
        action: "reply",
        workerId: "worker",
        assignmentId: "assignment",
        questionId: "question",
        text: "Target A",
      },
    }),
  ).toBe(true);
  expect(
    Value.Check(schema, { request: { action: "reply", workerId: "worker", text: "Target A" } }),
  ).toBe(false);
  expect(
    Value.Check(schema, { request: { action: "steer", workerId: "worker", text: "Focus" } }),
  ).toBe(false);
  expect(
    Value.Check(schema, {
      request: {
        action: "extend-budget",
        workerId: "worker",
        assignmentId: "assignment",
        additionalTurns: 0,
      },
    }),
  ).toBe(false);
  expect(Value.Check(schema, { request: { action: "release", workerId: "worker" } })).toBe(true);
});
