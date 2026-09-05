import { afterEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applyPiPatches } from "../../../lib/pi-npm";

interface PermissionSessionLike {
  getRegisteredInfrastructureReadDirectories(): string[];
  registerInfrastructureReadDirectory(directory: string): () => void;
  shutdown(): void;
}

interface PermissionsServiceLike {
  registerInfrastructureReadDirectory(directory: string): () => void;
}

interface PathNormalizerLike {
  forPath(path: string): unknown;
  isOutsideWorkingDirectory(path: string): boolean;
  isInfrastructureRead(toolName: string, path: unknown, directories: readonly string[]): boolean;
  approvalPatternFor(path: unknown): string;
}

type PermissionCheck = {
  toolName: string;
  state: "allow" | "deny" | "ask";
  source: "default";
  origin: "builtin";
  matchedPattern?: string;
};

interface GateResult {
  action?: "allow";
  preCheck?: PermissionCheck;
}

interface PermissionModules {
  PermissionSession: new (...args: unknown[]) => PermissionSessionLike;
  LocalPermissionsService: new (...args: unknown[]) => PermissionsServiceLike;
  PathNormalizer: new (flavor: unknown, cwd: string) => PathNormalizerLike;
  posixPathFlavor: unknown;
  describePathGate(
    context: {
      toolName: string;
      agentName: null;
      input: { path: string };
      toolCallId: string;
      cwd: string;
    },
    resolver: {
      resolve(intent: { surface: string; path: { matchValues(): string[] } }): PermissionCheck;
    },
    normalizer: PathNormalizerLike,
  ): GateResult | null;
  describeExternalDirectoryGate(
    context: {
      toolName: string;
      agentName: null;
      input: { path: string };
      toolCallId: string;
      cwd: string;
    },
    infrastructureDirectories: string[],
    resolver: { resolve(intent: { surface: string }): PermissionCheck },
    normalizer: PathNormalizerLike,
    extractors: undefined,
    registeredReadDirectories: readonly string[],
  ): GateResult | null;
}

const sourceRoot = new URL(
  "../../../npm/node_modules/@gotgenes/pi-permission-system/src/",
  import.meta.url,
);
const [sessionModule, serviceModule, normalizerModule, flavorModule, pathGateModule, gateModule] =
  await Promise.all([
    import(new URL("session/permission-session.ts", sourceRoot).href),
    import(new URL("service/permissions-service.ts", sourceRoot).href),
    import(new URL("path/path-normalizer.ts", sourceRoot).href),
    import(new URL("path/path-flavor.ts", sourceRoot).href),
    import(new URL("handlers/gates/path.ts", sourceRoot).href),
    import(new URL("handlers/gates/external-directory.ts", sourceRoot).href),
  ]);
const modules: PermissionModules = {
  PermissionSession: (
    sessionModule as { PermissionSession: PermissionModules["PermissionSession"] }
  ).PermissionSession,
  LocalPermissionsService: (
    serviceModule as { LocalPermissionsService: PermissionModules["LocalPermissionsService"] }
  ).LocalPermissionsService,
  PathNormalizer: (normalizerModule as { PathNormalizer: PermissionModules["PathNormalizer"] })
    .PathNormalizer,
  posixPathFlavor: (flavorModule as { posixPathFlavor: unknown }).posixPathFlavor,
  describePathGate: (pathGateModule as { describePathGate: PermissionModules["describePathGate"] })
    .describePathGate,
  describeExternalDirectoryGate: (
    gateModule as {
      describeExternalDirectoryGate: PermissionModules["describeExternalDirectoryGate"];
    }
  ).describeExternalDirectoryGate,
};

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createPermissionSession(): PermissionSessionLike {
  return new modules.PermissionSession(
    {
      agentDir: "/synthetic/agent",
      sessionsDir: "/synthetic/sessions",
      subagentSessionsDir: "/synthetic/subagents",
      forwardingDir: "/synthetic/forwarding",
      globalLogsDir: "/synthetic/logs",
      piInfrastructureDirs: [],
    },
    { start() {}, stop() {} },
    { configureForCwd() {} },
    { clear() {} },
    { current: () => ({}), refresh() {}, logResolvedPaths() {} },
    { activate() {}, deactivate() {} },
    modules.posixPathFlavor,
  );
}

function createPermissionsService(session: PermissionSessionLike): PermissionsServiceLike {
  return new modules.LocalPermissionsService({}, session, {}, {}, {});
}

function describeDeniedPath(cwd: string, path: string, deniedPath: string): GateResult | null {
  return modules.describePathGate(
    {
      toolName: "read",
      agentName: null,
      input: { path },
      toolCallId: "synthetic-read",
      cwd,
    },
    {
      resolve(intent) {
        const denied = intent.path.matchValues().includes(deniedPath);
        const check: PermissionCheck = {
          toolName: intent.surface,
          state: denied ? "deny" : "allow",
          source: "default",
          origin: "builtin",
        };
        return denied ? { ...check, matchedPattern: deniedPath } : check;
      },
    },
    new modules.PathNormalizer(modules.posixPathFlavor, cwd),
  );
}

function describeExternalAccess(
  cwd: string,
  toolName: string,
  path: string,
  registeredReadDirectories: string[],
): GateResult | null {
  const resolver = {
    resolve(intent: { surface: string }): PermissionCheck {
      return {
        toolName: intent.surface,
        state: "ask",
        source: "default",
        origin: "builtin",
        matchedPattern: "*",
      };
    },
  };
  return modules.describeExternalDirectoryGate(
    {
      toolName,
      agentName: null,
      input: { path },
      toolCallId: `synthetic-${toolName}`,
      cwd,
    },
    [],
    resolver,
    new modules.PathNormalizer(modules.posixPathFlavor, cwd),
    undefined,
    registeredReadDirectories,
  );
}

describe("registered infrastructure read directories", () => {
  test("reconstructs the package changes from the tracked patch", () => {
    const fixture = mkdtempSync(join(tmpdir(), "pi-permission-package-"));
    temporaryDirectories.push(fixture);
    const agentRoot = resolve(import.meta.dir, "../../..");
    const patch = join(agentRoot, "patches/@gotgenes+pi-permission-system+31.1.1.patch");
    const packageDirectory = join(fixture, "node_modules/@gotgenes/pi-permission-system");
    mkdirSync(join(fixture, "node_modules/@gotgenes"), { recursive: true });
    cpSync(join(agentRoot, "npm/node_modules/@gotgenes/pi-permission-system"), packageDirectory, {
      recursive: true,
    });
    expect(
      Bun.spawnSync(["git", "apply", "--reverse", "--check", patch], {
        cwd: fixture,
      }).exitCode,
    ).toBe(0);
    expect(Bun.spawnSync(["git", "apply", "--reverse", patch], { cwd: fixture }).exitCode).toBe(0);
    const source = join(packageDirectory, "src/session/permission-session.ts");
    expect(readFileSync(source, "utf8")).not.toContain("registerInfrastructureReadDirectory");
    writeFileSync(join(fixture, "package.json"), '{"private":true}\n');

    expect(applyPiPatches(fixture, false)).toBe(0);
    expect(readFileSync(source, "utf8")).toContain("registerInfrastructureReadDirectory");
  });

  test("allows only the built-in read tool", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-reference-read-directory-"));
    temporaryDirectories.push(root);
    const cwd = join(root, "project");
    const reference = join(root, "reference");
    const file = join(reference, "guide.md");
    mkdirSync(cwd);
    mkdirSync(reference);
    writeFileSync(file, "guide\n");

    const session = createPermissionSession();
    const permissions = createPermissionsService(session);
    expect(describeExternalAccess(cwd, "read", file, [])?.preCheck).toMatchObject({
      state: "ask",
    });

    const dispose = permissions.registerInfrastructureReadDirectory(reference);
    expect(session.getRegisteredInfrastructureReadDirectories()).toContain(realpathSync(reference));
    expect(
      describeExternalAccess(
        cwd,
        "read",
        file,
        session.getRegisteredInfrastructureReadDirectories(),
      ),
    ).toMatchObject({ action: "allow" });
    for (const toolName of ["grep", "find", "ls", "write", "edit"]) {
      expect(
        describeExternalAccess(
          cwd,
          toolName,
          file,
          session.getRegisteredInfrastructureReadDirectories(),
        )?.preCheck,
        toolName,
      ).toMatchObject({ state: "ask" });
    }

    dispose();
    expect(session.getRegisteredInfrastructureReadDirectories()).not.toContain(
      realpathSync(reference),
    );
  });

  test("keeps duplicate registrations independent and validates the boundary", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-reference-read-directory-"));
    temporaryDirectories.push(root);
    const reference = join(root, "reference");
    mkdirSync(reference);

    const session = createPermissionSession();
    const permissions = createPermissionsService(session);
    const disposeFirst = permissions.registerInfrastructureReadDirectory(reference);
    const disposeSecond = permissions.registerInfrastructureReadDirectory(reference);

    disposeFirst();
    expect(session.getRegisteredInfrastructureReadDirectories()).toContain(realpathSync(reference));
    disposeSecond();
    expect(session.getRegisteredInfrastructureReadDirectories()).not.toContain(
      realpathSync(reference),
    );
    expect(() => permissions.registerInfrastructureReadDirectory("relative/path")).toThrow(
      "must be absolute",
    );
    session.shutdown();
  });

  test("keeps quote and wildcard characters in canonical directory names literal", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-reference-read-directory-"));
    temporaryDirectories.push(root);
    const cwd = join(root, "project");
    const quoted = join(root, 'docs"');
    const quoteSibling = join(root, "docs");
    const wildcardTarget = join(root, "wild*");
    const wildcardSibling = join(root, "wild-unrelated");
    const deniedFile = join(root, "denied.txt");
    const escapingQuotedLink = join(wildcardTarget, 'secret"');
    for (const directory of [cwd, quoted, quoteSibling, wildcardTarget, wildcardSibling]) {
      mkdirSync(directory);
      writeFileSync(join(directory, "guide.md"), "guide\n");
    }
    writeFileSync(deniedFile, "secret\n");
    symlinkSync(deniedFile, escapingQuotedLink);

    const session = createPermissionSession();
    const permissions = createPermissionsService(session);
    permissions.registerInfrastructureReadDirectory(quoted);
    permissions.registerInfrastructureReadDirectory(wildcardTarget);
    const registrations = session.getRegisteredInfrastructureReadDirectories();

    expect(
      describeExternalAccess(cwd, "read", join(quoted, "guide.md"), registrations),
    ).toMatchObject({ action: "allow" });
    expect(
      describeExternalAccess(cwd, "read", join(quoteSibling, "guide.md"), registrations)?.preCheck,
    ).toMatchObject({ state: "ask" });
    expect(
      describeExternalAccess(cwd, "read", join(wildcardTarget, "guide.md"), registrations),
    ).toMatchObject({ action: "allow" });
    expect(
      describeExternalAccess(cwd, "read", join(wildcardSibling, "guide.md"), registrations)
        ?.preCheck,
    ).toMatchObject({ state: "ask" });
    expect(
      describeExternalAccess(cwd, "read", escapingQuotedLink, registrations)?.preCheck,
    ).toMatchObject({ state: "ask" });
    expect(
      describeDeniedPath(cwd, escapingQuotedLink, realpathSync(deniedFile))?.preCheck,
    ).toMatchObject({ state: "deny" });
  });
});
