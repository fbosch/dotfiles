import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  instructionFragmentsForTools,
  loadInstructionFragments,
} from "../../../extensions/instruction-fragments";

test("the evaluated rule matches the production fragment and requires codemode", () => {
  const fragments = loadInstructionFragments(resolve(import.meta.dir, "../../../instructions"), [
    "codemode.md",
  ]);
  const candidate = readFileSync(resolve(import.meta.dir, "../candidate.md"), "utf8").trim();

  expect(fragments[0]?.content).toBe(candidate);
  expect(instructionFragmentsForTools(fragments, ["codemode"])).toBe(candidate);
  expect(instructionFragmentsForTools(fragments, ["read"])).toBe("");
});
