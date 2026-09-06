import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sourceRoot = new URL(
  "../../../npm/node_modules/@gotgenes/pi-permission-system/src/",
  import.meta.url,
);
const [
  dialogModule,
  modelModule,
  storeModule,
  runnerModule,
  pathPayloadModule,
  dialogRendererModule,
] = await Promise.all([
  import(new URL("authority/permission-dialog.ts", sourceRoot).href),
  import(new URL("authority/permission-prompt-decision.ts", sourceRoot).href),
  import(new URL("config/persistent-approval-store.ts", sourceRoot).href),
  import(new URL("handlers/gates/runner.ts", sourceRoot).href),
  import(new URL("presentation/path-ask-payload.ts", sourceRoot).href),
  import(new URL("presentation/dialog-renderer.ts", sourceRoot).href),
]);

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

type PermissionUi = {
  select(title: string, options: string[]): Promise<string | undefined>;
  input(title: string, placeholder?: string): Promise<string | undefined>;
};

type Approval = {
  grants: readonly [{ surface: string; pattern: string }];
  isRecordable: boolean;
};

function createApproval(surface: string, pattern: string): Approval {
  return {
    grants: [{ surface, pattern }],
    isRecordable: true,
  };
}

function createAgentDir(): string {
  const root = mkdtempSync(join(tmpdir(), "pi-persistent-approval-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, "extensions/pi-permission-system"), { recursive: true });
  mkdirSync(join(root, "agents"), { recursive: true });
  return root;
}

describe("permission prompt details", () => {
  test("includes the full bash command for a path ask", () => {
    const payload = pathPayloadModule.buildPathAskPayload({
      toolName: "bash",
      command: "printf secret > .pi/mcp.json",
      pathValue: ".pi/mcp.json",
      agentName: "lookup",
      matchedPattern: "*/.pi/mcp.json",
      surface: "path_write",
    });

    expect(payload.evidence).toContainEqual({
      label: "command",
      text: "printf secret > .pi/mcp.json",
      detail: null,
    });
    const rendered = dialogRendererModule.renderPromptDialog(payload, {
      maxRows: 24,
      fieldMaxWidth: 400,
      width: 120,
    });
    expect(rendered.lines).toContain("command : printf secret > .pi/mcp.json");
  });
});

describe("persistent approval prompt", () => {
  test("asks for a durable scope after selecting future sessions", async () => {
    const calls: Array<{ title: string; options: string[] }> = [];
    const answers = ["Allow in future sessions…", "This agent/mode: lookup"];
    const ui: PermissionUi = {
      select: async (title, options) => {
        calls.push({ title, options });
        return answers.shift();
      },
      input: async () => undefined,
    };

    const decision = await dialogModule.requestPermissionDecisionFromUi(
      ui,
      "Permission Required",
      "Read a reference",
      {
        persistentScope: {
          agentLabel: "This agent/mode: lookup",
          globalLabel: "All agents/modes",
        },
      },
    );

    expect(decision).toMatchObject({
      approved: true,
      state: "approved",
      persistentApprovalScope: "agent",
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.options).toEqual([
      "Allow once",
      "Allow for this session",
      "Allow in future sessions…",
      "Deny",
      "Deny with reason",
    ]);
    expect(calls[1]?.options).toEqual(["This agent/mode: lookup", "All agents/modes"]);
  });

  test("cancelling the durable scope does not grant globally", async () => {
    let selectCount = 0;
    const ui: PermissionUi = {
      select: async () => {
        selectCount++;
        return selectCount === 1 ? "Allow in future sessions…" : undefined;
      },
      input: async () => undefined,
    };

    const decision = await dialogModule.requestPermissionDecisionFromUi(
      ui,
      "Permission Required",
      "Read a reference",
      {
        persistentScope: {
          agentLabel: "This agent/mode: lookup",
          globalLabel: "All agents/modes",
        },
      },
    );

    expect(decision).toMatchObject({ approved: false, state: "denied" });
    expect(decision).not.toHaveProperty("persistentApprovalScope");
  });
});

describe("persistent approval decision model", () => {
  const config = {
    doublePressToConfirm: false,
    sessionLabel: "Allow for this session",
    persistentScope: {
      agentLabel: "This agent/mode: lookup",
      globalLabel: "All agents/modes",
    },
  };

  test("offers the persistent option and defaults to the named agent", () => {
    expect(modelModule.visibleOptionKeys(config)).toEqual(["o", "s", "f", "n", "r"]);
    const state = modelModule.initialPromptState(config);
    const next = modelModule.reducePrompt(config, state, {
      type: "hotkey",
      key: "f",
    });
    expect(next).toMatchObject({
      kind: "render",
      state: { step: "persistent_scope", persistentScope: "agent" },
    });
    const decision = modelModule.reducePrompt(config, next.state, {
      type: "confirm",
    });
    expect(decision).toMatchObject({
      kind: "decision",
      decision: {
        approved: true,
        persistentApprovalScope: "agent",
      },
    });
  });

  test("moves from named-agent scope to global scope", () => {
    const state = modelModule.initialPromptState(config);
    const persistent = modelModule.reducePrompt(config, state, {
      type: "hotkey",
      key: "f",
    });
    const global = modelModule.reducePrompt(config, persistent.state, {
      type: "nav",
      direction: "down",
    });
    const decision = modelModule.reducePrompt(config, global.state, {
      type: "confirm",
    });
    expect(decision).toMatchObject({
      kind: "decision",
      decision: {
        approved: true,
        persistentApprovalScope: "global",
      },
    });
  });

  test("returns to the decision step when durable scope selection is cancelled", () => {
    const state = modelModule.initialPromptState(config);
    const persistent = modelModule.reducePrompt(config, state, {
      type: "hotkey",
      key: "f",
    });
    const cancelled = modelModule.reducePrompt(config, persistent.state, {
      type: "cancel",
    });

    expect(cancelled).toMatchObject({
      kind: "render",
      state: { step: "decision", persistentScope: "agent" },
    });
  });
});

describe("persistent approval gate", () => {
  const payload = {
    kind: "bash" as const,
    request: {
      requester: { agentName: "lookup", forwarded: false, sessionId: null },
      surface: "bash",
      toolName: "bash",
      invokedToolName: null,
      value: "git status",
      matchedPattern: "*",
      commandContext: null,
      executedUnit: null,
    },
    evidence: [],
    annotations: [],
  };

  function createRunner(
    persistApproval: (approval: unknown, scope: string, agentName?: string | null) => void,
  ) {
    const sessionApprovals: unknown[] = [];
    const decisions: unknown[] = [];
    const logs: unknown[] = [];
    const approval = {
      isRecordable: true,
      atWidth: () => approval,
      toForwardedData: () => ({ grants: [{ surface: "bash", pattern: "git status" }] }),
    };
    const runner = new runnerModule.GateRunner(
      { resolve: () => ({}) },
      { recordSessionApproval: (value: unknown) => sessionApprovals.push(value) },
      { persistApproval },
      {
        escalate: async () => ({
          approved: true,
          state: "approved",
          persistentApprovalScope: "global",
          decidedBy: { kind: "user", via: "select" },
        }),
      },
      {
        writeReviewLog: (event: string, details: unknown) => logs.push({ event, details }),
        emitDecision: (event: unknown) => decisions.push(event),
      },
      () => false,
    );
    const descriptor = {
      surface: "bash",
      input: { command: "git status" },
      payload,
      sessionApproval: approval,
      promptDetails: {
        source: "tool_call" as const,
        agentName: "lookup",
      },
      logContext: { source: "tool_call" },
      decision: { surface: "bash", value: "git status" },
      preCheck: {
        state: "ask" as const,
        toolName: "bash",
        source: "bash" as const,
        origin: "global",
      },
    };
    return { runner, descriptor, sessionApprovals, decisions, logs };
  }

  test("persists before granting the current call and records a session rule", async () => {
    const persisted: unknown[] = [];
    const harness = createRunner((approval, scope, agentName) =>
      persisted.push({ approval, scope, agentName }),
    );

    expect(await harness.runner.run(harness.descriptor, "lookup")).toEqual({
      action: "allow",
    });
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ scope: "global", agentName: "lookup" });
    expect(harness.sessionApprovals).toHaveLength(1);
  });

  test("blocks and records no session rule when persistence fails", async () => {
    const harness = createRunner(() => {
      throw new Error("read-only config");
    });

    const result = await harness.runner.run(harness.descriptor, "lookup");
    expect(result).toMatchObject({
      action: "block",
      reason: "Could not save the approval: read-only config",
    });
    expect(harness.sessionApprovals).toHaveLength(0);
    expect(harness.decisions[0]).toMatchObject({ result: "deny", resolution: "gate_error" });
    expect(harness.logs[0]).toMatchObject({ event: "permission_request.persistence_failed" });
  });
});

describe("persistent approval storage", () => {
  test("merges global rules and preserves unrelated settings", () => {
    const agentDir = createAgentDir();
    const configPath = join(agentDir, "extensions/pi-permission-system/config.json");
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          debugLog: true,
          permission: {
            "*": "ask",
            bash: { "git status": "deny", "*": "ask" },
          },
        },
        null,
        2,
      ),
    );

    new storeModule.PersistentApprovalStore(agentDir).persistApproval(
      createApproval("bash", "git status"),
      "global",
    );

    const saved = JSON.parse(readFileSync(configPath, "utf8")) as {
      debugLog: boolean;
      permission: { bash: Record<string, string> };
    };
    expect(saved.debugLog).toBe(true);
    expect(Object.entries(saved.permission.bash)).toEqual([
      ["*", "ask"],
      ["git status", "allow"],
    ]);
  });

  test("updates a symlinked named-agent profile without replacing the link", () => {
    const agentDir = createAgentDir();
    const target = join(agentDir, "lookup-source.md");
    const profile = join(agentDir, "agents/lookup.md");
    writeFileSync(
      target,
      [
        "---",
        "description: Lookup profile",
        "permission:",
        "  '*': deny",
        "  bash:",
        "    '*': ask",
        "---",
        "Body remains intact.",
        "",
      ].join("\n"),
    );
    symlinkSync(target, profile);

    new storeModule.PersistentApprovalStore(agentDir).persistApproval(
      createApproval("bash", "git status:short"),
      "agent",
      "lookup",
    );

    expect(existsSync(profile)).toBe(true);
    expect(readFileSync(profile, "utf8")).toContain('"git status:short": "allow"');
    expect(readFileSync(profile, "utf8")).toContain("Body remains intact.");
    expect(readFileSync(target, "utf8")).toContain("description: Lookup profile");
  });

  test("refuses to overwrite an invalid global config", () => {
    const agentDir = createAgentDir();
    const configPath = join(agentDir, "extensions/pi-permission-system/config.json");
    writeFileSync(configPath, "{ invalid");

    expect(() =>
      new storeModule.PersistentApprovalStore(agentDir).persistApproval(
        createApproval("bash", "git status"),
        "global",
      ),
    ).toThrow();
    expect(readFileSync(configPath, "utf8")).toBe("{ invalid");
  });
});
