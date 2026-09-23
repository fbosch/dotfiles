import { readStartupOwnerSnapshot, type StartupOwnerSnapshot } from "./contracts";
import {
  type AuthStartupPayload,
  type DirenvStartupPayload,
  type LspStartupPayload,
  type NeovimStartupPayload,
  readAuthStartupPayload,
  readDirenvStartupPayload,
  readLspStartupPayload,
  readNeovimStartupPayload,
} from "./owner-payloads";
import { readUpdateCoverage, type UpdateCoverage } from "./updates";

export function readHeaderOwnerSnapshot(value: unknown): StartupOwnerSnapshot | undefined {
  const snapshot = readStartupOwnerSnapshot(value);
  if (snapshot === undefined) return undefined;
  const payload = sanitizePayload(snapshot);
  return readStartupOwnerSnapshot({
    type: snapshot.type,
    schemaVersion: snapshot.schemaVersion,
    sessionId: snapshot.sessionId,
    generationId: snapshot.generationId,
    ownerId: snapshot.ownerId,
    ownerRevision: snapshot.ownerRevision,
    state: snapshot.state,
    ...(snapshot.observedAt === undefined ? {} : { observedAt: snapshot.observedAt }),
    ...(snapshot.staleAt === undefined ? {} : { staleAt: snapshot.staleAt }),
    ...(snapshot.expiresAt === undefined ? {} : { expiresAt: snapshot.expiresAt }),
    ...(payload === undefined ? {} : { payload }),
  });
}

type StartupHeaderPayload =
  | AuthStartupPayload
  | DirenvStartupPayload
  | LspStartupPayload
  | NeovimStartupPayload
  | UpdateCoverage
  | undefined;

function sanitizePayload(snapshot: StartupOwnerSnapshot): StartupHeaderPayload {
  switch (snapshot.ownerId) {
    case "auth":
      return readAuthStartupPayload(snapshot.payload);
    case "direnv":
      return readDirenvStartupPayload(snapshot.payload);
    case "lsp":
      return readLspStartupPayload(snapshot.payload);
    case "neovim":
      return readNeovimStartupPayload(snapshot.payload);
    case "updates":
      return readUpdateCoverage(snapshot.payload);
    default:
      return undefined;
  }
}
