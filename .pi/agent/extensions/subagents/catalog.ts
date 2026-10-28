import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadSkills } from "@earendil-works/pi-coding-agent";
import {
  type AssignmentOverrides,
  type CapabilityBundle,
  resolveSpecialist,
  type SpecialistCatalog,
} from "./specialist";

/** Trusted bundles select backing code; specialist tools are prewarming hints. */
export function capabilityCatalog(
  agentDir: string,
  skills: ReadonlyMap<string, string>,
  availableModels: ReadonlySet<string>,
): SpecialistCatalog {
  const local = (path: string) => join(agentDir, "extensions", path);
  const installed = (path: string) => join(agentDir, "npm/node_modules", path);
  const bundles = new Map<string, CapabilityBundle>([
    ["files", { extensions: [installed("pi-hashline-edit-pro/index.ts")] }],
    ["file-search", { extensions: [installed("@ff-labs/pi-fff/src/index.ts")] }],
    ["structural", { extensions: [installed("pi-lens/dist/index.js")] }],
    ["git-read", { extensions: [local("subagents/git-read.ts")] }],
    [
      "web",
      {
        extensions: [
          installed("pi-web-access/dist/index.js"),
          local("webfetch/index.ts"),
          local("websearch.ts"),
        ],
      },
    ],
    ["browser", { extensions: [local("browser/index.ts")] }],
    ["classifier", { extensions: [local("typesafe-question/index.ts")] }],
    ["commands", { extensions: [local("dekit/index.ts"), local("pi-comma/index.ts")] }],
    ["charts", { extensions: [local("chart/index.ts")] }],
    ["docs-mcp", { extensions: [], mcpServers: ["context7"] }],
    ["github-mcp", { extensions: [], mcpServers: ["github"] }],
    ["chrome-mcp", { extensions: [], mcpServers: ["chrome-devtools"] }],
    ["firefox-mcp", { extensions: [], mcpServers: ["firefox-devtools"] }],
  ]);
  return {
    baseline: {
      extensions: [
        local("auth-profiles/index.ts"),
        local("model-presets.ts"),
        local("openai-capabilities.ts"),
        local("classifier-policy/index.ts"),
        local("catastrophic-command-guard.ts"),
        local("semantic-command-guard/index.ts"),
        local("instruction-fragments.ts"),
      ],
    },
    bundles,
    skills,
    availableModels,
  };
}

export async function resolveNamedSpecialist(options: {
  name: string;
  agentDir: string;
  cwd: string;
  projectTrusted: boolean;
  availableModels: ReadonlySet<string>;
  overrides?: AssignmentOverrides;
}) {
  const { name, cwd, agentDir } = options;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) throw new Error("Invalid specialist name");
  let markdown: string | undefined;
  if (options.projectTrusted) {
    try {
      markdown = await readFile(join(cwd, ".pi/agents", `${name}.md`), "utf8");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  markdown ??= await readFile(join(agentDir, "agents", `${name}.md`), "utf8");
  const loaded = loadSkills({
    cwd: options.projectTrusted ? cwd : agentDir,
    agentDir,
    skillPaths: [
      join(homedir(), ".agents/skills"),
      ...(options.projectTrusted ? [join(cwd, ".agents/skills")] : []),
    ],
    includeDefaults: true,
  });
  const skills = new Map(loaded.skills.map((skill) => [skill.name, skill.filePath]));
  return resolveSpecialist(
    name,
    markdown,
    capabilityCatalog(agentDir, skills, options.availableModels),
    options.overrides,
  );
}
