import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { resolveNamedSpecialist } from "../../extensions/subagents/catalog";
import { createProductionExtension } from "../../extensions/subagents/production";
import { resolveSpecialist } from "../../extensions/subagents/specialist";

const fixture = dirname(fileURLToPath(import.meta.url));

// Exercise the production runner and child lifecycle with only isolated eval capabilities.
export async function resolveFixtureSpecialist(
  options: Parameters<typeof resolveNamedSpecialist>[0],
) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(options.name)) throw new Error("Invalid specialist name");
  const markdown = await readFile(join(options.agentDir, "agents", `${options.name}.md`), "utf8");
  return resolveSpecialist(
    options.name,
    markdown,
    {
      baseline: {
        extensions: [
          join(fixture, "../../extensions/openai-capabilities.ts"),
          join(fixture, "../../extensions/instruction-fragments.ts"),
          join(fixture, "fixture.ts"),
        ],
      },
      bundles: new Map(),
      skills: new Map(),
      availableModels: options.availableModels,
    },
    options.overrides,
  );
}

export default createProductionExtension({}, { resolve: resolveFixtureSpecialist });
