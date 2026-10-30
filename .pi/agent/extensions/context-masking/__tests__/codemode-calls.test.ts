import { expect, test } from "bun:test";
import type { JsonObject, NestedToolCalls } from "@earendil-works/pi-ai";
import { callsFor } from "../artifact-index";
import { codemodeCallSummary } from "../codemode-calls";
import { placeholder } from "../policy";
import { sessionWith } from "./fixtures";

const nested = (
  calls: [name: string, args?: JsonObject, status?: "ok" | "error" | "unfinished"][],
  complete = true,
): NestedToolCalls => ({
  calls: calls.map(([name, args, status], index) => ({
    id: `parent/${index + 1}`,
    name,
    ...(args === undefined ? {} : { arguments: args }),
    status: status ?? "ok",
  })),
  complete,
});

const codemode = (nestedCalls?: NestedToolCalls, details?: unknown) => ({
  toolName: "codemode",
  ...(nestedCalls === undefined ? {} : { nestedCalls }),
  ...(details === undefined ? {} : { details }),
});

test("names each inner call by its main argument, counts repeats, and marks failures", () => {
  const calls = nested([
    ["read", { path: ".pi/agent/settings.json" }],
    ["bash", { command: "bun test extensions/context-masking" }, "error"],
    ["grep", { pattern: "classifier", path: "lib" }],
    ["tasks", { action: "list" }],
    ["tasks", { action: "list" }],
  ]);
  expect(codemodeCallSummary(codemode(calls))).toBe(
    "read .pi/agent/settings.json; bash bun test extensions/context-masking (failed); grep lib; tasks ×2",
  );
});

test("says when Pi's record dropped calls or arguments", () => {
  const calls = nested([["write"]], false);
  expect(codemodeCallSummary(codemode(calls))).toBe("write; record incomplete");
});

test("falls back to codemode's details.calls, reading truncated argument JSON", () => {
  const details = {
    calls: [
      {
        name: "replace",
        args: '{"path":"docs/agents/pi-sdk.md","text":"long body that was cut off...',
        status: "ok",
      },
      { name: "bash", args: '{"command":"ls"}', status: "error" },
    ],
  };
  expect(codemodeCallSummary(codemode(undefined, details))).toBe(
    "replace docs/agents/pi-sdk.md; bash ls (failed)",
  );
  // Pi's own record wins when both exist.
  expect(codemodeCallSummary(codemode(nested([["read", { path: "a.md" }]]), details))).toBe(
    "read a.md",
  );
});

test("caps the summary and reports how many calls it left out", () => {
  const calls = nested(
    Array.from({ length: 30 }, (_, index) => ["read", { path: `src/module-${index}.ts` }]),
  );
  const summary = codemodeCallSummary(codemode(calls)) ?? "";
  expect(summary.length).toBeLessThanOrEqual(240);
  expect(summary).toStartWith("read src/module-0.ts; ");
  expect(summary).toMatch(/; \+\d+ more$/u);
});

test("returns nothing for other tools or codemode results without a call record", () => {
  expect(
    codemodeCallSummary({ toolName: "bash", nestedCalls: nested([["read", { path: "a" }]]) }),
  ).toBeUndefined();
  expect(codemodeCallSummary(codemode())).toBeUndefined();
  expect(codemodeCallSummary(codemode(nested([])))).toBeUndefined();
  expect(codemodeCallSummary(codemode(undefined, { fullOutputPath: "/tmp/x" }))).toBeUndefined();
});

test("recall labels a codemode result by its inner calls instead of the script source", () => {
  const nestedCalls = nested([
    ["read", { path: "docs/agents/pi-sdk.md" }],
    ["bash", { command: "bun run sdk:sync" }],
  ]);
  const { manager, resultIds } = sessionWith([
    {
      resultChars: 10,
      tool: "codemode",
      args: { code: "const jobs = [tools.read({ path: 'x' })];" },
      nestedCalls,
    },
    { resultChars: 10, tool: "codemode", args: { code: "return 1;" } },
    { resultChars: 10, tool: "bash", args: { command: "ls" } },
  ]);
  const labels = callsFor(manager.getBranch(), new Set(resultIds));
  expect(labels.get(resultIds[0] ?? "")).toBe("read docs/agents/pi-sdk.md; bash bun run sdk:sync");
  // Without a call record, codemode is described by its arguments like any other tool.
  expect(labels.get(resultIds[1] ?? "")).toContain("return 1;");
  expect(labels.get(resultIds[2] ?? "")).toBe("ls");
});

test("the mask placeholder lists a codemode result's inner calls", () => {
  const withCalls = placeholder(
    { entryId: "e1", toolName: "codemode", text: "a\nb", calls: "read docs/agents/pi-sdk.md" },
    "/cache/e1.txt",
  );
  expect(withCalls).toContain("Calls: read docs/agents/pi-sdk.md. Full text: /cache/e1.txt");
  const without = placeholder({ entryId: "e2", toolName: "bash", text: "a" }, "/cache/e2.txt");
  expect(without).not.toContain("Calls:");
});

test("long paths keep their file name; long commands keep their start", () => {
  const path = ".pi/agent/extensions/prompt-ui/__tests__/footer-rendering.test.ts";
  const command =
    "bun test extensions/context-masking/__tests__/recall-unified.test.ts --timeout 60000";
  const summary =
    codemodeCallSummary(
      codemode(
        nested([
          ["read", { path }],
          ["bash", { command }],
        ]),
      ),
    ) ?? "";
  const [read = "", bash = ""] = summary.split("; ");
  expect(read).toStartWith("read …");
  expect(read).toEndWith("/__tests__/footer-rendering.test.ts");
  expect(bash).toStartWith("bash bun test extensions/context-masking/");
  expect(bash).toEndWith("…");
});
