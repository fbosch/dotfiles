import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";

export interface PiLensServerCandidate {
  readonly extensions: readonly string[];
  readonly id: string;
}

interface ConfigLayer {
  readonly disabledServers: ReadonlySet<string>;
  readonly servers: ReadonlyMap<string, PiLensServerCandidate>;
}

export function loadPiLensServerCandidates(
  cwd: string,
  homeDirectory = homedir(),
): readonly PiLensServerCandidate[] {
  const global = readConfigLayer(join(homeDirectory, ".pi-lens", "config.json"));
  const project = readConfigLayer(join(cwd, ".pi-lens.json"));
  const servers = new Map(global.servers);
  for (const [id, server] of project.servers) servers.set(id, server);

  const disabled = new Set([...global.disabledServers, ...project.disabledServers]);
  return Object.freeze([...servers.values()].filter((server) => !disabled.has(server.id)));
}

export function matchesPiLensServer(server: PiLensServerCandidate, filePath: string): boolean {
  const fileName = basename(filePath);
  const extension = extname(filePath);
  return server.extensions.some(
    (candidate) =>
      candidate === fileName || candidate === extension || fileName.endsWith(candidate),
  );
}

function readConfigLayer(path: string): ConfigLayer {
  try {
    return parseConfigLayer(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyLayer();
    throw error;
  }
}

function parseConfigLayer(value: unknown): ConfigLayer {
  if (!isRecord(value) || !isRecord(value.lsp)) return emptyLayer();
  const disabledServers = new Set(
    Array.isArray(value.lsp.disabledServers)
      ? value.lsp.disabledServers.filter((item): item is string => typeof item === "string")
      : [],
  );
  const servers = new Map<string, PiLensServerCandidate>();
  if (isRecord(value.lsp.servers)) {
    for (const [id, server] of Object.entries(value.lsp.servers)) {
      if (!isRecord(server) || !Array.isArray(server.extensions)) continue;
      const extensions = server.extensions.filter(
        (extension): extension is string => typeof extension === "string" && extension !== "",
      );
      if (extensions.length > 0) servers.set(id, { id, extensions: Object.freeze(extensions) });
    }
  }
  return { disabledServers, servers };
}

function emptyLayer(): ConfigLayer {
  return { disabledServers: new Set(), servers: new Map() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
