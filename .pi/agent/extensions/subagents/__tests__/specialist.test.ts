import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSpecialist, type SpecialistCatalog, verifyChildCapabilities } from "../specialist";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function catalog(): Promise<SpecialistCatalog> {
  const root = await mkdtemp(join(tmpdir(), "pi-specialist-"));
  directories.push(root);
  const baseline = join(root, "policy.ts");
  const selected = join(root, "read.ts");
  const skill = join(root, "SKILL.md");
  await Promise.all([baseline, selected, skill].map((path) => writeFile(path, "fixture\n")));
  return {
    baseline: { extensions: [baseline] },
    bundles: new Map([["reading", { extensions: [selected] }]]),
    skills: new Map([["analysis", skill]]),
    availableModels: new Set(["presets/discovery", "presets/routine"]),
  };
}

function definition(overrides: Record<string, unknown> = {}): string {
  const fields = {
    description: "Bounded read-only inspection",
    model: "presets/discovery",
    max_turns: 12,
    tools: ["read", "codemode"],
    bundles: ["reading"],
    skills: ["analysis"],
    ...overrides,
  };
  return `---\n${Object.entries(fields)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n")}\n---\nInspect the supplied files without edits.\n`;
}

test("resolves only named capabilities while retaining the mandatory baseline", async () => {
  const available = await catalog();
  const resolved = await resolveSpecialist("explore", definition(), available);
  expect(resolved.model).toBe("presets/discovery");
  expect(resolved.maxTurns).toBe(12);
  expect(resolved.extensions).toEqual([
    ...available.baseline.extensions,
    ...available.bundles.get("reading")!.extensions,
  ]);
  expect(resolved.skills).toEqual([{ name: "analysis", path: available.skills.get("analysis")! }]);
  expect(resolved.excludeTools).toContain("mcp__*");
  expect(resolved.excludeTools).toContain("subagent");
  expect(resolved.prompt).toBe("Inspect the supplied files without edits.");
});

test("omits the specialist hard ceiling when none is configured", async () => {
  const resolved = await resolveSpecialist("explore", definition(), await catalog());
  expect(resolved).not.toHaveProperty("hardMaxTurns");
});

test("accepts equal or lower assignment ceilings and retains the frozen full role cap", async () => {
  const available = await catalog();
  const specialist = definition({ hard_max_turns: 20 });
  const equal = await resolveSpecialist("explore", specialist, available, { hardMaxTurns: 20 });
  expect(equal.hardMaxTurns).toBe(20);

  const overrides = { hardMaxTurns: 15 };
  const lowered = await resolveSpecialist("explore", specialist, available, overrides);
  overrides.hardMaxTurns = 14;
  expect(lowered.hardMaxTurns).toBe(20);
  expect(lowered.maxTurns).toBe(12);
  expect(Object.isFrozen(lowered)).toBe(true);
});

test("rejects raised or too-small assignment ceilings and allowances above the selected ceiling", async () => {
  const available = await catalog();
  const specialist = definition({ hard_max_turns: 20 });
  await expect(
    resolveSpecialist("explore", specialist, available, { hardMaxTurns: 21 }),
  ).rejects.toThrow("exceeds specialist hard_max_turns");
  await expect(
    resolveSpecialist("explore", specialist, available, { hardMaxTurns: 11 }),
  ).rejects.toThrow("maxTurns exceeds assignment hardMaxTurns");
  await expect(
    resolveSpecialist("explore", specialist, available, { maxTurns: 21 }),
  ).rejects.toThrow("maxTurns exceeds assignment hardMaxTurns");
  await expect(
    resolveSpecialist("explore", definition({ max_turns: 21, hard_max_turns: 20 }), available),
  ).rejects.toThrow("maxTurns exceeds assignment hardMaxTurns");
});

test("rejects missing, invalid, and overflowing hard ceilings before resolution", async () => {
  const available = await catalog();
  await expect(
    resolveSpecialist("explore", definition(), available, { hardMaxTurns: 12 }),
  ).rejects.toThrow("requires specialist hard_max_turns");

  for (const hard_max_turns of [0, -1, 1.5, "20", Number.MAX_SAFE_INTEGER + 1]) {
    await expect(
      resolveSpecialist("explore", definition({ hard_max_turns }), available),
    ).rejects.toThrow("hard_max_turns must be a positive safe integer");
  }
  for (const hardMaxTurns of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await expect(
      resolveSpecialist("explore", definition({ hard_max_turns: 20 }), available, { hardMaxTurns }),
    ).rejects.toThrow("hardMaxTurns must be a positive safe integer");
  }
});

test("retained configuration is immutable and detached from catalog arrays", async () => {
  const available = await catalog();
  const baseline = [...available.baseline.extensions];
  const resolved = await resolveSpecialist("explore", definition(), {
    ...available,
    baseline: { extensions: baseline },
  });
  baseline.push("/changed-later.ts");
  expect(resolved.extensions).not.toContain("/changed-later.ts");
  expect(Object.isFrozen(resolved)).toBe(true);
  expect(Object.isFrozen(resolved.tools)).toBe(true);
  expect(Object.isFrozen(resolved.skills[0])).toBe(true);
});

test("model and thinking overrides require separate explicit permission", async () => {
  const available = await catalog();
  await expect(
    resolveSpecialist("explore", definition(), available, { model: "presets/routine" }),
  ).rejects.toThrow("model override");
  await expect(
    resolveSpecialist("explore", definition(), available, { thinking: "high" }),
  ).rejects.toThrow("thinking override");
  const resolved = await resolveSpecialist(
    "general",
    definition({ allow_overrides: ["model", "thinking"] }),
    available,
    {
      model: "presets/routine",
      thinking: "low",
      maxTurns: 24,
    },
  );
  expect(resolved.model).toBe("presets/routine");
  expect(resolved.thinking).toBe("low");
  expect(resolved.maxTurns).toBe(24);
});

test("missing model, bundle, skill, or mandatory baseline fails preflight", async () => {
  const available = await catalog();
  await expect(
    resolveSpecialist("explore", definition({ model: "missing/model" }), available),
  ).rejects.toThrow("Required model");
  await expect(
    resolveSpecialist("explore", definition({ bundles: ["missing"] }), available),
  ).rejects.toThrow("Required capability bundle");
  await expect(
    resolveSpecialist("explore", definition({ skills: ["missing"] }), available),
  ).rejects.toThrow("Required skill");
  await expect(
    resolveSpecialist("explore", definition(), { ...available, baseline: { extensions: [] } }),
  ).rejects.toThrow("Mandatory baseline");
});

test("missing extension and skill files fail rather than silently dropping capabilities", async () => {
  const available = await catalog();
  await expect(
    resolveSpecialist("explore", definition(), {
      ...available,
      baseline: { extensions: [join(directories[0]!, "missing.ts")] },
    }),
  ).rejects.toThrow("Required capability file");
  await expect(
    resolveSpecialist("explore", definition(), {
      ...available,
      skills: new Map([["analysis", join(directories[0]!, "missing.md")]]),
    }),
  ).rejects.toThrow("Required capability file");
});

test("rejects unsupported permission maps, invalid budgets, and implicit tool expansion", async () => {
  const available = await catalog();
  await expect(
    resolveSpecialist("explore", definition({ permission: { "*": "deny" } }), available),
  ).rejects.toThrow("not enforced");
  for (const max_turns of [0, -1, 1.5, "12"]) {
    await expect(
      resolveSpecialist("explore", definition({ max_turns }), available),
    ).rejects.toThrow("positive safe integer");
  }
  for (const tools of [["*"], ["+read"], ["subagent"]]) {
    await expect(resolveSpecialist("explore", definition({ tools }), available)).rejects.toThrow(
      "explicit allowlist",
    );
  }
});

test("empty skill and bundle selections are explicit; invalid names never fall back", async () => {
  const available = await catalog();
  const resolved = await resolveSpecialist(
    "explore",
    definition({ skills: [], bundles: [] }),
    available,
  );
  expect(resolved.skills).toEqual([]);
  expect(resolved.extensions).toEqual(available.baseline.extensions);
  await expect(resolveSpecialist("../explore", definition(), available)).rejects.toThrow(
    "Invalid specialist name",
  );
  await expect(
    resolveSpecialist("explore", definition({ skills: null }), available),
  ).rejects.toThrow("explicit list");
});

test("actual child loadout must satisfy required patterns without additional callable tools", async () => {
  const available = await catalog();
  const resolved = await resolveSpecialist(
    "explore",
    definition({ tools: ["read", "mcp__docs__*"] }),
    available,
  );
  expect(resolved.excludeTools).not.toContain("mcp__*");
  expect(() =>
    verifyChildCapabilities(resolved, ["read", "codemode", "mcp__docs__lookup"]),
  ).not.toThrow();
  expect(() => verifyChildCapabilities(resolved, ["read"])).toThrow("Required child tool");
  expect(() =>
    verifyChildCapabilities(resolved, ["read", "codemode", "mcp__docs__lookup", "bash"]),
  ).toThrow("Unexpected callable child tool");
  expect(() =>
    verifyChildCapabilities(resolved, ["read", "codemode", "mcp__docs__lookup", "subagent"]),
  ).toThrow("Unexpected callable child tool");
});

test("codemode is shared with specialists and deduplicated when explicitly listed", async () => {
  const available = await catalog();
  const implicit = await resolveSpecialist("explore", definition({ tools: ["read"] }), available);
  expect(implicit.tools).toEqual(["read", "codemode"]);

  const explicit = await resolveSpecialist(
    "explore",
    definition({ tools: ["read", "codemode", "codemode"] }),
    available,
  );
  expect(explicit.tools).toEqual(["read", "codemode"]);
});
