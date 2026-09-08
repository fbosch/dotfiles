import { readStartupOwnerSnapshot, type StartupOwnerSnapshot } from "./contracts";
import {
  readAuthStartupPayload,
  readDirenvStartupPayload,
  readLspStartupPayload,
  readNeovimStartupPayload,
} from "./owner-payloads";
import { readContextEstimate } from "./runtime-capability";
import { readUpdateCoverage } from "./updates";

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

function sanitizePayload(snapshot: StartupOwnerSnapshot): unknown {
  switch (snapshot.ownerId) {
    case "context":
      return readContextEstimate(snapshot.payload);
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
