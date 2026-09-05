import { describe, expect, test } from "bun:test";
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
};

type PermissionManagerModule = {
  PermissionManager: new (options: {
    agentDir: string;
    isYoloEnabled?: () => boolean;
  }) => PermissionManagerLike;
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

function createEngine(isYoloEnabled = false): PermissionEngine {
  const manager = new modules.PermissionManager({
    agentDir,
    isYoloEnabled: () => isYoloEnabled,
  });
  manager.configureForCwd(repoRoot);

  return {
    manager,
    resolver: new modules.PermissionResolver(manager, {
      getRuleset: () => [],
    }),
    normalizer: new modules.PathNormalizer(modules.posixPathFlavor, repoRoot),
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

    for (const command of ["set -o pipefail", "git status --short", "git diff --check", "pwd"]) {
      expect((await checkBash(engine, command)).state, command).toBe("allow");
    }

    expect(pathGate(engine, "read", "src/example.ts")).toBeNull();
    expect(pathGate(engine, "edit", "src/example.ts")).toBeNull();
  });

  test("asks for destructive, unknown, and unlisted shell operations", async () => {
    const engine = createEngine();
    const commands = [
      "git -C . reset --hard",
      "git branch -D feature",
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
  });

  test("keeps privileged shell commands explicitly denied", async () => {
    const engine = createEngine();

    for (const command of ["sudo id", "doas id", "pkexec id"]) {
      expect((await checkBash(engine, command)).state, command).toBe("deny");
    }
  });

  test("denies credential paths through the cross-cutting path gate", () => {
    const engine = createEngine();

    for (const path of ["~/.pi/agent/auth.json", "~/dotfiles/.pi/agent/auth.json"]) {
      const result = pathGate(engine, "read", path);
      expect(result, path).not.toBeNull();
      expect(result?.preCheck?.state, path).toBe("deny");
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

  test("preserves explicit denies when yolo rewrites asks", async () => {
    const yoloEngine = createEngine(true);

    expect((await checkBash(yoloEngine, "git -C . reset --hard")).state).toBe("allow");
    expect((await checkBash(yoloEngine, "sudo id")).state).toBe("deny");
  });
});
