import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Pi from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  CHILD_PROTOCOL_TOOLS,
  createChildSession,
} from "../../../extensions/subagents/child-session";
import { resolveFixtureSpecialist } from "../runner";

test("eval workers use the real child lifecycle and share the controlled barrier", async () => {
  const root = await mkdtemp(join(tmpdir(), "orchestration-runner-"));
  const previous = { ...process.env };
  const children: Array<{ close: () => Promise<void> }> = [];
  try {
    const agentDir = join(root, ".pi/agent");
    const work = join(root, "fixture");
    const trace = join(root, "trace.jsonl");
    await mkdir(join(agentDir, "agents"), { recursive: true });
    await mkdir(join(agentDir, "instructions/orchestration"), { recursive: true });
    await mkdir(join(root, ".agents/skills/swarm"), { recursive: true });
    await mkdir(work);
    await writeFile(join(root, ".agents/skills/swarm/SKILL.md"), "# Fixture skill\n");
    await writeFile(
      join(agentDir, "instructions/orchestration/index.md"),
      "# Fixture instructions\n",
    );
    await writeFile(join(root, "catalog.json"), JSON.stringify({ agents: { quick: {} } }));
    await mkdir(join(root, "instructions/orchestration"), { recursive: true });
    await writeFile(join(root, "instructions/orchestration/index.md"), "# Fixture instructions\n");
    Object.assign(process.env, {
      HOME: root,
      PI_CODING_AGENT_DIR: agentDir,
      ORCHESTRATION_TRACE: trace,
      ORCHESTRATION_WORK: work,
      ORCHESTRATION_MODEL_CATALOG: join(root, "catalog.json"),
    });
    const models = await Pi.ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: join(agentDir, "models.json"),
      modelsStorePath: join(agentDir, "models-store.json"),
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    const model = models.getModels()[0];
    if (!model) throw new Error("Fixture needs a static model catalog");
    const reference = `${model.provider}/${model.id}`;
    await writeFile(
      join(agentDir, "agents/quick.md"),
      [
        "---",
        "description: Fixture specialist",
        `model: ${reference}`,
        "max_turns: 8",
        "hard_max_turns: 8",
        "tools: read, grep, find, ls, eval_gate",
        "bundles: []",
        "skills: []",
        "---",
        "Read only assigned files.",
      ].join("\n"),
    );
    const options = {
      name: "quick",
      agentDir,
      cwd: work,
      projectTrusted: true,
      availableModels: new Set([reference]),
    };
    const config = await resolveFixtureSpecialist(options);
    expect(config.maxTurns).toBe(8);
    expect(config.skills).toEqual([]);
    expect(config.extensions).toHaveLength(3);
    await expect(
      resolveFixtureSpecialist({
        ...options,
        overrides: { maxTurns: 9 },
      }),
    ).rejects.toThrow("hardMaxTurns");
    await expect(
      resolveFixtureSpecialist({
        ...options,
        name: "../quick",
      }),
    ).rejects.toThrow("Invalid specialist name");
    const protocol: Pi.ExtensionFactory = (pi) => {
      for (const name of CHILD_PROTOCOL_TOOLS)
        pi.registerTool({
          name,
          label: name,
          description: name,
          parameters: Type.Object({}),
          async execute() {
            return { content: [], details: undefined };
          },
        });
    };
    const gates = [];
    for (let i = 0; i < 2; i++) {
      const child = await createChildSession({
        config,
        cwd: work,
        agentDir,
        model,
        protocol,
        onUncertainStartup: (error) => {
          throw error;
        },
      });
      children.push(child);
      const tools = child.session.getCallableToolNames();
      expect(tools).toContain("eval_gate");
      expect(tools).not.toContain("subagent");
      const gate = child.session.agent.state.tools.find((tool) => tool.name === "eval_gate");
      if (!gate) throw new Error("Missing fixture gate");
      gates.push(gate);
    }
    const [left, right] = gates;
    if (!left || !right) throw new Error("Missing barrier participants");
    await Promise.all([
      left.execute("left", { action: "barrier", key: "left" }),
      right.execute("right", { action: "barrier", key: "right" }),
    ]);
    const events = (await readFile(trace, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const arrivals = events.filter((event) => event.kind === "barrier-arrived");
    expect(new Set(arrivals.map((event) => event.session)).size).toBe(2);
    expect(events.filter((event) => event.kind === "barrier-passed")).toHaveLength(2);
  } finally {
    for (const child of children.reverse()) await child.close();
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
