import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface PermissionSessionLike {
  getInfrastructureReadDirs(): string[];
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
  describeExternalDirectoryGate(
    context: {
      toolName: string;
      agentName: null;
      input: { path: string };
      toolCallId: string;
      cwd: string;
    },
    directories: string[],
    resolver: { resolve(intent: { surface: string }): PermissionCheck },
    normalizer: PathNormalizerLike,
  ): GateResult | null;
}

const sourceRoot = new URL(
  "../../../npm/node_modules/@gotgenes/pi-permission-system/src/",
  import.meta.url,
);
const [sessionModule, serviceModule, normalizerModule, flavorModule, gateModule] =
  await Promise.all([
    import(new URL("session/permission-session.ts", sourceRoot).href),
    import(new URL("service/permissions-service.ts", sourceRoot).href),
    import(new URL("path/path-normalizer.ts", sourceRoot).href),
    import(new URL("path/path-flavor.ts", sourceRoot).href),
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

function describeExternalAccess(
  cwd: string,
  toolName: string,
  path: string,
  directories: string[],
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
    directories,
    resolver,
    new modules.PathNormalizer(modules.posixPathFlavor, cwd),
  );
}

describe("registered infrastructure read directories", () => {
  test("allows read-only tools without allowing writes", () => {
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
    expect(
      describeExternalAccess(cwd, "read", file, session.getInfrastructureReadDirs())?.preCheck,
    ).toMatchObject({ state: "ask" });

    const dispose = permissions.registerInfrastructureReadDirectory(reference);
    expect(session.getInfrastructureReadDirs()).toContain(realpathSync(reference));
    expect(
      describeExternalAccess(cwd, "read", file, session.getInfrastructureReadDirs()),
    ).toMatchObject({ action: "allow" });
    expect(
      describeExternalAccess(cwd, "write", file, session.getInfrastructureReadDirs())?.preCheck,
    ).toMatchObject({ state: "ask" });

    dispose();
    expect(session.getInfrastructureReadDirs()).not.toContain(realpathSync(reference));
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
    expect(session.getInfrastructureReadDirs()).toContain(realpathSync(reference));
    disposeSecond();
    expect(session.getInfrastructureReadDirs()).not.toContain(realpathSync(reference));
    expect(() => permissions.registerInfrastructureReadDirectory("relative/path")).toThrow(
      "must be absolute",
    );
    expect(() => permissions.registerInfrastructureReadDirectory("/tmp/reference-*")).toThrow(
      "must not contain wildcard",
    );

    session.shutdown();
  });
});
