import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { resolveSpecialist } from "../specialist";
import { registerParentTools } from "../tools";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
const readme = () => readFile(join(import.meta.dir, "..", "README.md"), "utf8");

test("documented specialist configuration resolves through the production parser", async () => {
  const markdown = await readme();
  const definition = /```yaml\n([\s\S]*?)\n```/.exec(markdown)?.[1];
  if (!definition) throw new Error("Specialist example missing");
  const directory = await mkdtemp(join(tmpdir(), "pi-subagent-readme-"));
  directories.push(directory);
  const baseline = join(directory, "baseline.ts");
  await writeFile(baseline, "export default function () {}\n");
  const resolved = await resolveSpecialist("fixture", definition, {
    baseline: { extensions: [baseline] },
    bundles: new Map(),
    skills: new Map(),
    availableModels: new Set(["fixture/model"]),
  });
  expect(resolved.model).toBe("fixture/model");
  expect(resolved.maxTurns).toBe(12);
  expect(resolved.tools).toEqual(["read", "codemode"]);
  expect(resolved.prompt).toContain("report what you checked");
});

test("documented parent requests satisfy the registered tool schemas", async () => {
  const schemas = new Map<string, TSchema>();
  registerParentTools(
    {
      registerTool(tool) {
        schemas.set(tool.name, tool.parameters);
      },
    },
    () => {
      throw new Error("Schema check must not construct a runtime");
    },
  );
  const blocks = [...(await readme()).matchAll(/```json\n([\s\S]*?)\n```/g)];
  const names = ["subagent", "subagent_result", "subagent_control"];
  expect(blocks).toHaveLength(names.length);
  for (const [index, block] of blocks.entries()) {
    const schema = schemas.get(names[index]!);
    if (!schema) throw new Error("Documented tool is not registered");
    for (const line of block[1]!.split("\n")) {
      const request: unknown = JSON.parse(line);
      expect(Value.Check(schema, request)).toBe(true);
    }
  }
});
