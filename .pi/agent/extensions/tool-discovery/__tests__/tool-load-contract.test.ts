import { expect, test } from "bun:test";
import { join } from "node:path";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import {
  instructionFragmentsForTools,
  loadInstructionFragments,
} from "../../instruction-fragments";
import toolDiscoveryExtension, { isDeferredToolName } from "../index";

test("registers only tool_load with the existing query/limit contract", () => {
  const registered: string[] = [];
  const pi = {
    registerTool(tool: ToolDefinition) {
      registered.push(tool.name);
      expect(tool.label).toBe("Load tools");
      expect(tool.exposure ?? "direct").toBe("direct");
      expect(Value.Check(tool.parameters, { query: "browser screenshot", limit: 3 })).toBe(true);
      expect(Value.Check(tool.parameters, {})).toBe(false);
      expect(tool.promptGuidelines).toContain(
        "Use tool_load when the current tools cannot perform the task or a needed tool is not active.",
      );
    },
    on() {},
  } as unknown as ExtensionAPI;
  toolDiscoveryExtension(pi);
  expect(registered).toEqual(["tool_load"]);
  expect(isDeferredToolName("tool_load", ["tool_"])).toBe(false);
});

test("scopes local loader guidance to tool_load without renaming native helpers", () => {
  const directory = join(import.meta.dir, "..", "..", "..", "instructions");
  const fragments = loadInstructionFragments(directory, ["tool-discovery.md"]);
  const guidance = instructionFragmentsForTools(fragments, ["tool_load"]);
  expect(guidance).toContain("tools.tool_load({ query, limit })");
  expect(guidance).toContain("Pi's native `searchTools()`");
  expect(guidance).toContain("Pi's `tool_search`");
  expect(guidance).toContain("no old-name tool alias is registered");
  expect(instructionFragmentsForTools(fragments, ["read", "tool_search"])).toBe("");
});
