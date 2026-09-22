import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverAgentDefinitions } from "../discovery";
import { recommendAgent } from "../recommendation";
import { DEFAULT_RECOMMEND_AGENT_CONFIG, resolveRecommendAgentConfig } from "../settings";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "recommend-agent-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function definition(directory: string, name: string, description: string, enabled = true): void {
  writeFileSync(
    join(directory, `${name}.md`),
    `---\ndescription: ${description}\nenabled: ${enabled}\n---\nbody must never be exposed`,
  );
}

function responseFor(choice: string, catalog: readonly string[], confidence = 0.95): Response {
  const probabilities = Object.fromEntries(
    [...catalog, "stay", "abstain"].map((candidate) => [
      candidate,
      candidate === choice ? confidence : (1 - confidence) / (catalog.length + 1),
    ]),
  );
  return new Response(
    JSON.stringify({
      answers: { route: { type: "choice", choice, confidence, probabilities } },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const registry = {
  getProviderAuth: async () => ({ auth: { apiKey: "test-key" } }),
};

const enabledConfig = {
  ...DEFAULT_RECOMMEND_AGENT_CONFIG,
  enabled: true,
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("recommend agent discovery", () => {
  test("follows defaults, global definitions, trusted project precedence, and disabled overrides", () => {
    const root = temporaryDirectory();
    const globalAgents = join(root, "global", "agents");
    const projectAgents = join(root, ".pi", "agents");
    mkdirSync(globalAgents, { recursive: true });
    mkdirSync(projectAgents, { recursive: true });
    definition(globalAgents, "analyze", "Global analyze role");
    definition(globalAgents, "Plan", "Global plan role");
    definition(projectAgents, "analyze", "Trusted project analyze role");
    definition(projectAgents, "Plan", "Hidden project plan role", false);

    const trusted = discoverAgentDefinitions({
      cwd: root,
      projectTrusted: true,
      agentDir: join(root, "global"),
    });
    expect(trusted.failure).toBeUndefined();
    expect(trusted.catalog?.definitions.find(({ id }) => id === "analyze")).toMatchObject({
      description: "Trusted project analyze role",
      source: "project",
    });
    expect(trusted.catalog?.definitions.some(({ id }) => id === "Plan")).toBe(false);
    expect(trusted.catalog?.definitions.some(({ id }) => id === "general-purpose")).toBe(true);

    const untrusted = discoverAgentDefinitions({
      cwd: root,
      projectTrusted: false,
      agentDir: join(root, "global"),
    });
    expect(untrusted.catalog?.definitions.find(({ id }) => id === "analyze")).toMatchObject({
      description: "Global analyze role",
      source: "global",
    });
    expect(untrusted.catalog?.definitions.find(({ id }) => id === "Plan")).toMatchObject({
      description: "Global plan role",
      source: "global",
    });
  });

  test("does not expose definition bodies, paths, or reserved option ids", () => {
    const root = temporaryDirectory();
    const globalAgents = join(root, "agents");
    mkdirSync(globalAgents, { recursive: true });
    definition(globalAgents, "lookup", "Use /Users/fbb/private-file token=secret for lookup");
    definition(globalAgents, "stay", "must be excluded");

    const result = discoverAgentDefinitions({ cwd: root, projectTrusted: false, agentDir: root });
    expect(result.catalog?.definitions.some(({ id }) => id === "stay")).toBe(false);
    const lookup = result.catalog?.definitions.find(({ id }) => id === "lookup");
    expect(lookup?.description).not.toContain("/Users/fbb");
    expect(lookup?.description).not.toContain("secret");
  });
});

describe("recommend agent configuration and routing", () => {
  test("is disabled by default and ignores project-only configuration", () => {
    expect(resolveRecommendAgentConfig({})).toEqual(DEFAULT_RECOMMEND_AGENT_CONFIG);
    expect(
      resolveRecommendAgentConfig({ jev: { recommendAgent: { enabled: "yes" } } }),
    ).toMatchObject({
      enabled: false,
    });
    expect(
      resolveRecommendAgentConfig({ jev: { recommendAgent: { enabled: true } } }),
    ).toMatchObject({
      enabled: true,
    });
    expect(resolveRecommendAgentConfig({ recommendAgent: { enabled: true } })).toEqual(
      DEFAULT_RECOMMEND_AGENT_CONFIG,
    );
  });

  test("uses Choice and returns one discovered id without spawning anything", async () => {
    const root = temporaryDirectory();
    const agents = join(root, "agents");
    mkdirSync(agents, { recursive: true });
    definition(agents, "analyze", "Analyze existing code");
    let calls = 0;
    let requestBody: Record<string, unknown> | undefined;
    const fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls += 1;
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const state = requestBody.state as { agents: readonly { id: string }[] };
      return responseFor(
        "analyze",
        state.agents.map(({ id }) => id),
      );
    };

    const result = await recommendAgent(
      { task: "Trace the data flow", intent: "Explain the existing implementation" },
      {
        modelRegistry: registry,
        config: enabledConfig,
        discovery: { cwd: root, projectTrusted: false, agentDir: root },
        fetch,
      },
    );
    expect(result.decision).toEqual({ decision: "recommend", agentId: "analyze" });
    expect(result.catalogKind).toBe("discovered-definitions");
    expect(calls).toBe(1);
    expect(JSON.stringify(requestBody)).not.toContain("body must never be exposed");
  });

  test("bypasses the gateway when explicit routing is present", async () => {
    let calls = 0;
    const fetch = async (): Promise<Response> => {
      calls += 1;
      return responseFor("stay", []);
    };
    const result = await recommendAgent(
      { task: "@review inspect this change", intent: "Use the explicitly selected agent" },
      {
        modelRegistry: registry,
        config: enabledConfig,
        discovery: {
          cwd: temporaryDirectory(),
          projectTrusted: false,
          agentDir: temporaryDirectory(),
        },
        fetch,
      },
    );
    expect(result.decision).toEqual({ decision: "abstain", reason: "explicit-routing" });
    expect(calls).toBe(0);
  });

  test("abstains on uncertainty and stale catalog responses", async () => {
    const root = temporaryDirectory();
    const agents = join(root, "agents");
    mkdirSync(agents, { recursive: true });
    definition(agents, "analyze", "Analyze existing code");
    const uncertain = await recommendAgent(
      { task: "Trace the data flow", intent: "Explain the existing implementation" },
      {
        modelRegistry: registry,
        config: enabledConfig,
        discovery: { cwd: root, projectTrusted: false, agentDir: root },
        fetch: async (_input, init) => {
          const body = JSON.parse(String(init?.body)) as {
            state: { agents: readonly { id: string }[] };
          };
          return responseFor(
            "analyze",
            body.state.agents.map(({ id }) => id),
            0.4,
          );
        },
      },
    );
    expect(uncertain.decision).toEqual({ decision: "abstain", reason: "uncertain" });

    let responseCalls = 0;
    const stale = await recommendAgent(
      { task: "Trace the data flow", intent: "Explain the existing implementation" },
      {
        modelRegistry: registry,
        config: enabledConfig,
        discovery: { cwd: root, projectTrusted: false, agentDir: root },
        fetch: async (_input, init) => {
          const body = JSON.parse(String(init?.body)) as {
            state: { agents: readonly { id: string }[] };
          };
          responseCalls += 1;
          writeFileSync(
            join(agents, "analyze.md"),
            `---\ndescription: Changed after request ${responseCalls}\n---\n`,
          );
          return responseFor(
            "analyze",
            body.state.agents.map(({ id }) => id),
          );
        },
      },
    );
    expect(stale.decision).toEqual({ decision: "abstain", reason: "stale-catalog" });
  });
});
