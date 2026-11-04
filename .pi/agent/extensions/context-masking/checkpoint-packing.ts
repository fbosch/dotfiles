import { Buffer } from "node:buffer";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  argumentPointer,
  codemodePreview,
  type ReferencePart,
  renderReferenceManifest,
} from "./checkpoint-format";
import {
  MAX_IMAGE_BYTES as MAX_ARCHIVE_BYTES,
  type MaskedItem,
  saveConversationArtifact,
} from "./evidence-archive";

export type CheckpointPart = ReferencePart;
export type PackedCheckpoint = {
  text: string;
  parts: CheckpointPart[];
  savedItems: MaskedItem[];
  unpackedBytes: number;
  inlineBytes: number;
  fits: boolean;
};

const render = (parts: readonly CheckpointPart[]) => parts.map((part) => part.text).join("\n\n");

export const manifestPointer = (groups: number, path: string) =>
  `[Retained references: ${groups} groups. Manifest]: ${path}`;
export async function packCheckpoint(
  parts: readonly CheckpointPart[],
  limit: number,
  artifactRoot: string,
  sessionId: string | undefined,
  signal?: AbortSignal,
): Promise<PackedCheckpoint> {
  signal?.throwIfAborted();
  const original = render(parts);
  const inlineBytes = Buffer.byteLength(
    render(parts.filter((part) => part.reference === undefined)),
  );
  const result: PackedCheckpoint = {
    text: original,
    parts: [...parts],
    savedItems: [],
    unpackedBytes: Buffer.byteLength(original),
    inlineBytes,
    fits: Buffer.byteLength(original) <= limit,
  };
  // Required inline content must not move into an archive to meet the budget.
  if (inlineBytes > limit) return result;
  const calls = parts.filter(
    (part) =>
      part.reference !== undefined &&
      part.text.length > 512 &&
      codemodePreview(part.text, part.summary) !== undefined,
  );
  let callArchive: MaskedItem | undefined;
  let compacted = [...parts];
  if (calls.length) {
    if (!sessionId) throw Error("Call archive requires a session ID");
    const text = `${calls.map((part) => part.text).join("\n")}\n`;
    if (Buffer.byteLength(text) > MAX_ARCHIVE_BYTES)
      throw Error("Call archive exceeds the archive limit");
    signal?.throwIfAborted();
    const record = await saveConversationArtifact(artifactRoot, sessionId, text);
    callArchive = { ...record, toolName: "compaction:calls", text };
    const indexes = new Map(calls.map((part, index) => [part, index]));
    compacted = parts.map((part) => {
      const index = indexes.get(part);
      return index === undefined
        ? part
        : {
            ...part,
            text: `${argumentPointer(index, record.path)}\n${codemodePreview(part.text, part.summary)}`,
          };
    });
  }
  const text = render(compacted);
  Object.assign(result, {
    text,
    parts: compacted,
    savedItems: callArchive ? [callArchive] : [],
    fits: Buffer.byteLength(text) <= limit,
  });
  const references = compacted.filter((part) => part.reference !== undefined);
  if (result.fits || !references.length) return result;
  if (!sessionId) throw Error("Reference manifest requires a session ID");
  const manifest = renderReferenceManifest(
    compacted,
    join(await realpath(artifactRoot), sessionId),
    callArchive?.path,
  );
  if (Buffer.byteLength(manifest) > MAX_ARCHIVE_BYTES)
    throw Error("Reference manifest exceeds the archive limit");
  signal?.throwIfAborted();
  const record = await saveConversationArtifact(artifactRoot, sessionId, manifest);
  const pointer = {
    reference: `manifest:${record.entryId}`,
    text: manifestPointer(new Set(references.map((part) => part.reference)).size, record.path),
  };
  let inserted = false;
  const packed = compacted.flatMap((part) => {
    if (part.reference === undefined) return [part];
    if (inserted) return [];
    inserted = true;
    return [pointer];
  });
  const packedText = render(packed);
  return {
    ...result,
    text: packedText,
    parts: packed,
    savedItems: [
      { ...record, toolName: "compaction:references", text: manifest },
      ...(callArchive ? [callArchive] : []),
    ],
    fits: Buffer.byteLength(packedText) <= limit,
  };
}
