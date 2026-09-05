import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type PermissionState = "allow" | "deny" | "ask";

type PermissionCheck = {
  state: PermissionState;
  matchedPattern?: string;
  origin: string;
};

type ToolIntent = {
  kind: "tool";
  surface: string;
  input: unknown;
  agentName?: string;
};

type PathValuesIntent = {
  kind: "path-values";
  surface: string;
  values: readonly string[];
  agentName?: string;
};

type PermissionManagerLike = {
  configureForCwd(cwd: string | undefined | null): void;
  check(intent: ToolIntent | PathValuesIntent): PermissionCheck;
  getConfigIssues(): string[];
};

type PermissionManagerModule = {
  PermissionManager: new (options: { agentDir: string }) => PermissionManagerLike;
};

type PermissionResolverLike = {
  resolve(intent: unknown): PermissionCheck;
};

type PermissionResolverModule = {
  PermissionResolver: new (
    permissionManager: PermissionManagerLike,
    sessionRules: { getRuleset(): unknown[] },
  ) => PermissionResolverLike;
};

type AccessPathLike = {
  matchValues(): string[];
  boundaryValue(): string;
  value(): string;
  resolvedAlias(): string | undefined;
};

type PathNormalizerLike = {
  forPath(path: string, options?: { resolveBase?: string }): AccessPathLike;
  isOutsideWorkingDirectory(path: string): boolean;
  isInfrastructureRead(
    toolName: string,
    path: AccessPathLike,
    infrastructureDirs: readonly string[],
  ): boolean;
  approvalPatternFor(path: AccessPathLike): string;
};

type PathNormalizerModule = {
  PathNormalizer: new (flavor: unknown, cwd: string) => PathNormalizerLike;
};

type ToolCallContext = {
  toolName: string;
  agentName: string | null;
  input: unknown;
  toolCallId: string;
  cwd: string;
};

type GateResult = {
  surface?: string;
  preCheck?: PermissionCheck;
  action?: "allow";
} | null;

type PathGate = (
  context: ToolCallContext,
  resolver: PermissionResolverLike,
  normalizer: PathNormalizerLike,
  extractors?: unknown,
) => GateResult;

type ExternalDirectoryGate = (
  context: ToolCallContext,
  infrastructureDirs: string[],
  resolver: PermissionResolverLike,
  normalizer: PathNormalizerLike,
  extractors?: unknown,
) => GateResult;

type GateModule = {
  describePathGate: PathGate;
  describeExternalDirectoryGate: ExternalDirectoryGate;
};

type BashProgramLike = {
  commands(): readonly unknown[];
};

type BashProgramModule = {
  BashProgram: {
    parse(
      command: string,
      normalizer: PathNormalizerLike,
      options?: { workdir?: string },
    ): Promise<BashProgramLike>;
  };
};

type BashCheck = (
  command: string,
  commands: readonly unknown[],
  agentName: string | undefined,
  resolver: PermissionResolverLike,
) => PermissionCheck;

type BashCheckModule = {
  resolveBashCommandCheck: BashCheck;
};

type BashPathGate = (
  context: ToolCallContext,
  program: BashProgramLike,
  resolver: PermissionResolverLike,
  normalizer: PathNormalizerLike,
) => GateResult;

type ChainVerdict = { kind: "allow" } | { kind: "deny"; reason?: string } | { kind: "defer" };

type PermissionPromptDecision = {
  approved: boolean;
  state: string;
  decidedBy: unknown;
};

type ChainDetails = Record<string, unknown>;
type ChainAuthorizer = (
  details: ChainDetails,
  query: unknown,
  log: unknown,
) => Promise<ChainVerdict>;
type TerminalAuthorizer = {
  authorize(details: ChainDetails): Promise<PermissionPromptDecision>;
};

type AuthorizerChainModule = {
  composeAuthorizerChain(
    links: readonly { name: string; authorize: ChainAuthorizer }[],
    terminal: TerminalAuthorizer,
    query: unknown,
    log: unknown,
  ): TerminalAuthorizer;
};

type DelegationEnvelopeModule = {
  encloseInDelegationEnvelope(authorize: ChainAuthorizer): ChainAuthorizer;
};

type PermissionModules = {
  PermissionManager: PermissionManagerModule["PermissionManager"];
  PermissionResolver: PermissionResolverModule["PermissionResolver"];
  PathNormalizer: PathNormalizerModule["PathNormalizer"];
  posixPathFlavor: unknown;
  describePathGate: PathGate;
  describeExternalDirectoryGate: ExternalDirectoryGate;
  BashProgram: BashProgramModule["BashProgram"];
  resolveBashCommandCheck: BashCheck;
  describeBashPathGate: BashPathGate;
  composeAuthorizerChain: AuthorizerChainModule["composeAuthorizerChain"];
  encloseInDelegationEnvelope: DelegationEnvelopeModule["encloseInDelegationEnvelope"];
};

const sourceRoot = new URL(
  "../../../npm/node_modules/@gotgenes/pi-permission-system/src/",
  import.meta.url,
);
const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const agentDir = join(repoRoot, ".pi", "agent");

async function loadPermissionModules(): Promise<PermissionModules> {
  const [
    managerModule,
    resolverModule,
    normalizerModule,
    flavorModule,
    pathGateModule,
    externalDirectoryGateModule,
    bashProgramModule,
    bashCheckModule,
    bashPathModule,
    chainModule,
    delegationEnvelopeModule,
  ] = await Promise.all([
    import(new URL("permission-manager.ts", sourceRoot).href),
    import(new URL("permission-resolver.ts", sourceRoot).href),
    import(new URL("path-normalizer.ts", sourceRoot).href),
    import(new URL("path/path-flavor.ts", sourceRoot).href),
    import(new URL("handlers/gates/path.ts", sourceRoot).href),
    import(new URL("handlers/gates/external-directory.ts", sourceRoot).href),
    import(new URL("access-intent/bash/program.ts", sourceRoot).href),
    import(new URL("handlers/gates/bash-command.ts", sourceRoot).href),
    import(new URL("handlers/gates/bash-path.ts", sourceRoot).href),
    import(new URL("authority/authorizer-chain.ts", sourceRoot).href),
    import(new URL("authority/delegation-envelope.ts", sourceRoot).href),
  ]);

  return {
    PermissionManager: (managerModule as unknown as PermissionManagerModule).PermissionManager,
    PermissionResolver: (resolverModule as unknown as PermissionResolverModule).PermissionResolver,
    PathNormalizer: (normalizerModule as unknown as PathNormalizerModule).PathNormalizer,
    posixPathFlavor: (flavorModule as { posixPathFlavor: unknown }).posixPathFlavor,
    describePathGate: (pathGateModule as unknown as GateModule).describePathGate,
    describeExternalDirectoryGate: (externalDirectoryGateModule as unknown as GateModule)
      .describeExternalDirectoryGate,
    BashProgram: (bashProgramModule as unknown as BashProgramModule).BashProgram,
    resolveBashCommandCheck: (bashCheckModule as unknown as BashCheckModule)
      .resolveBashCommandCheck,
    describeBashPathGate: (bashPathModule as { describeBashPathGate: BashPathGate })
      .describeBashPathGate,
    composeAuthorizerChain: (chainModule as unknown as AuthorizerChainModule)
      .composeAuthorizerChain,
    encloseInDelegationEnvelope: (delegationEnvelopeModule as unknown as DelegationEnvelopeModule)
      .encloseInDelegationEnvelope,
  };
}

const modules = await loadPermissionModules();

type PermissionEngine = {
  manager: PermissionManagerLike;
  resolver: PermissionResolverLike;
  normalizer: PathNormalizerLike;
};

function createEngine(cwd = repoRoot): PermissionEngine {
  const manager = new modules.PermissionManager({ agentDir });
  manager.configureForCwd(cwd);

  return {
    manager,
    resolver: new modules.PermissionResolver(manager, {
      getRuleset: () => [],
    }),
    normalizer: new modules.PathNormalizer(modules.posixPathFlavor, cwd),
  };
}

async function checkBash(engine: PermissionEngine, command: string): Promise<PermissionCheck> {
  const program = await modules.BashProgram.parse(command, engine.normalizer);
  return modules.resolveBashCommandCheck(command, program.commands(), undefined, engine.resolver);
}

function toolContext(toolName: string, input: unknown): ToolCallContext {
  return {
    toolName,
    agentName: null,
    input,
    toolCallId: `synthetic-${toolName}`,
    cwd: repoRoot,
  };
}

function pathGate(engine: PermissionEngine, toolName: string, path: string): GateResult {
  return modules.describePathGate(
    toolContext(toolName, { path }),
    engine.resolver,
    engine.normalizer,
  );
}

function externalDirectoryGate(
  engine: PermissionEngine,
  toolName: string,
  path: string,
): GateResult {
  return modules.describeExternalDirectoryGate(
    toolContext(toolName, { path }),
    [],
    engine.resolver,
    engine.normalizer,
  );
}

describe("pi-permission-system v29 policy", () => {
  test("loads valid global and project policy without config issues", () => {
    expect(createEngine().manager.getConfigIssues()).toEqual([]);
  });

  test("allows ordinary local file tools and named safe shell commands", async () => {
    const engine = createEngine();

    expect(
      engine.manager.check({
        kind: "tool",
        surface: "read",
        input: { path: "src/example.ts" },
      }).state,
    ).toBe("allow");
    expect(
      engine.manager.check({
        kind: "tool",
        surface: "edit",
        input: { path: "src/example.ts", oldText: "before", newText: "after" },
      }).state,
    ).toBe("allow");

    for (const command of [
      "set -o pipefail",
      "git status --short",
      "git diff --check",
      "git worktree prune --dry-run",
      "pwd",
    ]) {
      expect((await checkBash(engine, command)).state, command).toBe("allow");
    }

    expect(pathGate(engine, "read", "src/example.ts")).toBeNull();
    expect(pathGate(engine, "edit", "src/example.ts")).toBeNull();
  });

  test("asks for destructive, unknown, and unlisted shell operations", async () => {
    const engine = createEngine();
    const commands = [
      "git -C . reset --hard",
      "set -o pipefail; git -C . reset --hard",
      "git branch -D feature",
      "git worktree prune",
      "git worktree prune --dry-run --no-dry-run",
      "git diff --output=synthetic-output.txt",
      "find . -delete",
      "gh api -X DELETE repos/example/project",
      "gh api repos/example/project -X DELETE",
      "unknown-shell-command --synthetic",
      "wt remove feature",
    ];

    for (const command of commands) {
      expect((await checkBash(engine, command)).state, command).toBe("ask");
    }

    expect(
      engine.manager.check({
        kind: "tool",
        surface: "unknown_tool",
        input: { value: "synthetic" },
      }).state,
    ).toBe("ask");
    expect(
      engine.manager.check({
        kind: "tool",
        surface: "worktrunk",
        input: { command: "remove", args: ["--force", "--force-delete", "feature"] },
      }).state,
    ).toBe("ask");
  });

  test("scopes named checks to the dotfiles project", async () => {
    const project = createEngine();
    const otherProject = createEngine(join(repoRoot, "synthetic-unconfigured-project"));

    for (const command of ["devenv test", "bun test extensions", "bun run typecheck"]) {
      expect((await checkBash(project, command)).state, command).toBe("allow");
      expect((await checkBash(otherProject, command)).state, command).toBe("ask");
    }
  });

  test("keeps privileged shell commands explicitly denied", async () => {
    const engine = createEngine();

    for (const command of ["sudo id", "doas id", "pkexec id", "su root"]) {
      expect((await checkBash(engine, command)).state, command).toBe("deny");
    }
  });

  test("denies credential paths through resolver path-values intents", () => {
    const engine = createEngine();
    const syntheticAuthPaths = [
      join(homedir(), ".pi/agent/auth.json"),
      join(homedir(), "dotfiles/.pi/agent/auth.json"),
    ];

    for (const path of [...syntheticAuthPaths, join(repoRoot, "synthetic-secret.env")]) {
      for (const surface of ["path_read", "path_write"]) {
        const result = engine.resolver.resolve({
          kind: "path-values",
          surface,
          values: [path],
        });
        expect(result.state, `${surface}: ${path}`).toBe("deny");
      }
    }
  });

  test("protected-file asks never override a secret deny on another path alias", async () => {
    const engine = createEngine();
    const config = JSON.parse(
      await readFile(new URL("../config.json", import.meta.url), "utf8"),
    ) as {
      permission: { path: Record<string, PermissionState> };
    };

    // Directional entries append after bare path rules, so path_write must reassert the denies last.
    for (const [pattern, state] of Object.entries(config.permission.path)) {
      if (state !== "deny") continue;
      const fixture = pattern.replaceAll("*", "synthetic-secret");
      const secretAlias = fixture.startsWith("~/")
        ? join(homedir(), fixture.slice(2))
        : join(repoRoot, fixture);
      for (const surface of ["path_read", "path_write"]) {
        expect(
          engine.resolver.resolve({
            kind: "path-values",
            surface,
            values: [join(repoRoot, ".pi/agent/settings.json"), secretAlias],
          }).state,
          `${surface}: ${pattern}`,
        ).toBe("deny");
      }
    }
  });

  test("asks before writes to global and project policy files and settings aliases", () => {
    const engine = createEngine();
    const protectedWrites = [
      "~/dotfiles/.pi/agent/extensions/pi-permission-system/config.json",
      "$HOME/dotfiles/.pi/agent/extensions/pi-permission-system/config.json",
      "~/dotfiles/.pi/extensions/pi-permission-system/config.json",
      "$HOME/dotfiles/.pi/extensions/pi-permission-system/config.json",
      "~/.pi/agent/settings.json",
      "$HOME/.pi/agent/settings.json",
      "~/dotfiles/.pi/agent/settings.json",
      "$HOME/dotfiles/.pi/agent/settings.json",
    ];

    for (const path of protectedWrites) {
      const result = pathGate(engine, "write", path);
      expect(result, path).not.toBeNull();
      expect(result?.preCheck?.state, path).toBe("ask");
    }
  });

  test("gates redirects even when the command itself is allowed", async () => {
    const engine = createEngine();
    const cases = [
      ["printf x > .pi/agent/settings.json", "ask"],
      ["echo x > ./synthetic-policy-secret.env", "deny"],
    ] as const;

    for (const [command, expected] of cases) {
      expect((await checkBash(engine, command)).state).toBe("allow");
      const program = await modules.BashProgram.parse(command, engine.normalizer);
      const gate = modules.describeBashPathGate(
        toolContext("bash", { command }),
        program,
        engine.resolver,
        engine.normalizer,
      );
      expect(gate?.preCheck?.state, command).toBe(expected);
    }
  });

  test("allows MCP discovery and context7 reads while asking for GitHub mutations", () => {
    const engine = createEngine();

    // Discovery targets follow server/search candidates; a surface catch-all would mask them.
    for (const input of [{}, { server: "context7" }, { search: "context7" }]) {
      expect(engine.manager.check({ kind: "tool", surface: "mcp", input }).state).toBe("allow");
    }

    expect(
      engine.manager.check({
        kind: "tool",
        surface: "mcp",
        input: { server: "context7", tool: "get-library-docs" },
      }).state,
    ).toBe("allow");
    expect(
      engine.manager.check({
        kind: "tool",
        surface: "mcp",
        input: { server: "github", tool: "delete_repository" },
      }).state,
    ).toBe("ask");
  });

  test("allows external reads from project policy and asks for external writes", () => {
    const engine = createEngine();
    const externalPath = "~/nixos/synthetic-fixture.txt";

    const readResult = externalDirectoryGate(engine, "read", externalPath);
    expect(readResult?.preCheck?.state).toBe("allow");

    const writeResult = externalDirectoryGate(engine, "write", externalPath);
    expect(writeResult?.preCheck?.state).toBe("ask");
  });

  test("evaluates chained shell commands through each command unit", async () => {
    const engine = createEngine();
    const result = await checkBash(engine, "set -o pipefail; git status --short");

    expect(result.state).toBe("allow");
  });

  test("/yolo can approve ordinary asks but the delegation envelope protects path asks", async () => {
    const terminal: TerminalAuthorizer = {
      authorize: async () => ({
        approved: false,
        state: "denied",
        decidedBy: { kind: "terminal" },
      }),
    };
    const query = {};
    const log = { review() {}, debug() {} };
    const allow = modules.encloseInDelegationEnvelope(async () => ({
      kind: "allow",
    }));
    const chain = modules.composeAuthorizerChain(
      [{ name: "session-yolo", authorize: allow }],
      terminal,
      query,
      log,
    );

    const ordinaryAsk = {
      surface: "bash",
      value: "git -C . reset --hard",
      accessIntent: {
        surface: "bash",
        matchValues: ["git -C . reset --hard"],
        boundaryValue: null,
      },
    };
    const pathAsk = {
      surface: "path_write",
      value: "~/dotfiles/.pi/agent/settings.json",
      accessIntent: {
        surface: "path_write",
        matchValues: ["/synthetic/settings.json"],
        boundaryValue: "/synthetic/settings.json",
      },
    };

    expect((await chain.authorize(ordinaryAsk)).approved).toBe(true);
    expect((await chain.authorize(pathAsk)).approved).toBe(false);
  });
});
