import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { isMatching, P } from "ts-pattern";
import { MARKER, type MaskCandidate } from "./policy";
import {
  checkImageProcessingAbort,
  MAX_IMAGE_BYTES,
  normalizeImageForClassifier,
  readImageBytes,
  validateImageInput,
  writeArchiveBytes,
  type ImageMime,
} from "./image-artifact";
import { readSavedArtifact, SavedArtifactSnapshotChanged } from "./saved-artifact";

export { SavedArtifactSnapshotChanged, MAX_IMAGE_BYTES };
export const MAX_TEXT_ARCHIVE_BYTES = MAX_IMAGE_BYTES;
export const IMAGE_ARCHIVE = "context-masking-image-archive";

export interface MaskedItem {
  entryId: string;
  // Content-addressed files keep their hash separate from the originating session entry.
  archiveId?: string;
  toolName: string;
  path: string;
  text?: string;
}

export interface ArchivedImage {
  id: string;
  entryId: string;
  blockIndex: number;
  sessionId: string;
  path: string;
  mimeType: string;
  sha256: string;
  bytes: number;
}

export type ImageArchiveRecord = ArchivedImage & {
  action: "inline" | "reference" | "omit";
  forced: boolean;
  label?: string | undefined;
};

export type ImageInput = { data: string; mimeType: string };

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const SHA_PATTERN = /^[a-f0-9]{64}$/u;
const TextCatalogPattern = {
  type: "custom",
  customType: "context-masking",
  data: { items: P.array({
    entryId: P.string, toolName: P.string, path: P.string,
    archiveId: P.optional(P.string.regex(SHA_PATTERN)), text: P.optional(P.string),
  }) },
};
const ImageRecordPattern = {
  id: P.string,
  entryId: P.string,
  blockIndex: P.number.int().gte(0),
  sessionId: P.string,
  path: P.string,
  mimeType: P.string,
  sha256: P.string,
  bytes: P.number.int().gte(1),
};
const ImageArchivePattern = {
  ...ImageRecordPattern,
  action: P.union("inline", "reference", "omit"),
  forced: P.boolean,
  label: P.optional(P.string),
};
const ImageArchiveEntryPattern = { images: P.array(ImageArchivePattern) };

const safeName = (value: string) => value.replace(/[^A-Za-z0-9_-]/gu, "_");

function imageMime(value: string): ImageMime {
  if (value !== "image/png" && value !== "image/jpeg")
    throw new Error("Unsupported image MIME type");
  return value;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function imageId(
  sessionId: string,
  entryId: string,
  blockIndex: number,
  mimeType: ImageMime,
  bytes: number,
  sha256: string,
): string {
  const identity = `${sessionId}\0${entryId}\0${blockIndex}\0${mimeType}\0${bytes}\0${sha256}`;
  return createHash("sha256").update(identity).digest("hex");
}

/** Writes masked tool outputs using their established session/entry paths and best-effort behavior. */
export async function saveMaskedTextArtifacts(
  root: string,
  sessionId: string,
  candidates: readonly MaskCandidate[],
): Promise<{ candidate: MaskCandidate; path: string }[]> {
  const dir = join(root, safeName(sessionId));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const written: { candidate: MaskCandidate; path: string }[] = [];
  for (const candidate of candidates) {
    const path = join(dir, `${safeName(candidate.entryId)}.txt`);
    try {
      await writeFile(path, candidate.text, { mode: 0o600 });
      written.push({ candidate, path });
    } catch {
      // Never hide a result that cannot be read back.
    }
  }
  return written;
}

/** Persists content-addressed conversation evidence in its existing private text format. */
export async function saveConversationArtifact(root: string, sessionId: string, text: string) {
  const bytes = Buffer.from(text, "utf8");
  if (!bytes.length || bytes.length > MAX_TEXT_ARCHIVE_BYTES)
    throw new Error("Conversation archive exceeds its size limit");
  const entryId = createHash("sha256").update(bytes).digest("hex");
  const path = await writeArchiveBytes(root, sessionId, `${entryId}.txt`, bytes);
  return { entryId, toolName: "conversation", path };
}

export async function saveImageArtifact(
  root: string,
  sessionId: string,
  entryId: string,
  blockIndex: number,
  image: ImageInput,
): Promise<ArchivedImage> {
  if (!validId(entryId) || !validId(sessionId)) throw new Error("Invalid image source ID");
  if (!Number.isSafeInteger(blockIndex) || blockIndex < 0)
    throw new Error("Invalid image block index");
  const { bytes, mimeType } = await validateImageInput(image);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const id = imageId(sessionId, entryId, blockIndex, mimeType, bytes.length, sha256);
  const extension = mimeType === "image/png" ? "png" : "jpg";
  const fileName = `image-${id}.${extension}`;
  const path = await writeArchiveBytes(root, sessionId, fileName, bytes);
  return { id, entryId, blockIndex, sessionId, path, mimeType, sha256, bytes: bytes.length };
}

function validateImageRecord(
  rootPath: string,
  sessionId: string,
  record: ArchivedImage,
): { mimeType: ImageMime; fileName: string; bytes: number } {
  if (!record || typeof record !== "object") throw new Error("Invalid archived image record");
  if (
    !validId(sessionId) ||
    !validId(record.sessionId) ||
    record.sessionId !== sessionId ||
    !validId(record.entryId) ||
    !Number.isSafeInteger(record.blockIndex) ||
    record.blockIndex < 0 ||
    !SHA_PATTERN.test(record.sha256) ||
    !Number.isSafeInteger(record.bytes) ||
    record.bytes < 1 ||
    record.bytes > MAX_IMAGE_BYTES
  )
    throw new Error("Invalid archived image metadata");
  const mimeType = imageMime(record.mimeType);
  const id = imageId(record.sessionId, record.entryId, record.blockIndex, mimeType, record.bytes, record.sha256);
  if (record.id !== id) throw new Error("Archived image ID does not match its metadata");
  const extension = mimeType === "image/png" ? "png" : "jpg";
  const fileName = `image-${id}.${extension}`;
  if (
    record.path !== join(rootPath, sessionId, fileName) ||
    !/^image-[a-f0-9]{64}\.(?:png|jpg)$/u.test(fileName)
  )
    throw new Error("Invalid archived image path");
  return { mimeType, fileName, bytes: record.bytes };
}

export async function readImageArtifact(
  root: string,
  sessionId: string,
  record: ArchivedImage,
): Promise<{ type: "image"; data: string; mimeType: string }> {
  if (typeof root !== "string" || root.length === 0)
    throw new Error("Invalid image archive root");
  const canonicalRoot = await realpath(resolve(root));
  const metadata = validateImageRecord(canonicalRoot, sessionId, record);
  const bytes = await readImageBytes(
    root,
    sessionId,
    metadata.fileName,
    metadata.bytes,
    record.sha256,
    metadata.mimeType,
  );
  return { type: "image", data: bytes.toString("base64"), mimeType: metadata.mimeType };
}

export async function classifierImage(
  root: string,
  sessionId: string,
  record: ArchivedImage,
  signal?: AbortSignal,
): Promise<{ type: "image"; data: string; mimeType: string }> {
  checkImageProcessingAbort(signal);
  const original = await readImageArtifact(root, sessionId, record);
  checkImageProcessingAbort(signal);
  const normalized = await normalizeImageForClassifier(
    Buffer.from(original.data, "base64"),
    original.mimeType,
    signal,
  );
  return { type: "image", data: normalized.toString("base64"), mimeType: original.mimeType };
}

export async function classifierImagePart(
  root: string,
  sessionId: string,
  record: ArchivedImage,
  signal?: AbortSignal,
): Promise<{ type: "image_url"; image_url: { url: string } }> {
  const image = await classifierImage(root, sessionId, record, signal);
  return {
    type: "image_url",
    image_url: { url: `data:${image.mimeType};base64,${image.data}` },
  };
}

// Recover the old rolling-v1 catalog only while affected persisted sessions are retained.
// Both committed mask pointers and assessed body hashes must bind an archive to its source.
function legacyRollingRecords(branch: readonly SessionEntry[]) {
  const tools = new Map<string, string>();
  const assessed = new Map<string, Set<string>>();
  const references: Array<{ sourceId: string; path: string }> = [];
  const auditPattern = {
    version: 1,
    assessments: P.array({ sourceId: P.string, bodyDigest: P.string.regex(SHA_PATTERN) }),
  };
  for (const entry of branch) {
    if (entry.type === "message" && entry.message.role === "toolResult")
      tools.set(entry.id, entry.message.toolName);
    if (entry.type === "custom" && entry.customType === "context-masking-rolling") {
      const data: unknown = entry.data;
      if (!isMatching(auditPattern, data)) continue;
      for (const item of data.assessments) {
        const digests = assessed.get(item.sourceId) ?? new Set<string>();
        digests.add(item.bodyDigest);
        assessed.set(item.sourceId, digests);
      }
    }
    if (entry.type !== "context_edit") continue;
    const replacement: unknown = entry.replacement;
    if (!isMatching({ content: P.array({ type: "text", text: P.string }) }, replacement)) continue;
    const [part] = replacement.content;
    if (replacement.content.length !== 1 || !part?.text.startsWith(MARKER)) continue;
    const path = / Full text: (.+) — use read with offset and limit if you need it again\.$/u.exec(part.text)?.[1];
    if (path) references.push({ sourceId: entry.targetId, path });
  }
  const records = new Map<string, Array<{ entryId: string; archiveId: string; toolName: string }>>();
  for (const { sourceId, path } of references) {
    const archiveId = basename(path, ".txt");
    const toolName = tools.get(sourceId);
    if (!toolName || !SHA_PATTERN.test(archiveId) || !assessed.get(sourceId)?.has(archiveId)) continue;
    const sources = records.get(path) ?? [];
    sources.push({ entryId: sourceId, archiveId, toolName });
    records.set(path, sources);
  }
  return records;
}

/** Parses text catalog entries without binding text artifacts to the active session. */
export function savedItems(branch: readonly SessionEntry[]): Map<string, MaskedItem> {
  const items = new Map<string, MaskedItem>();
  let legacy: ReturnType<typeof legacyRollingRecords> | undefined;
  for (const entry of branch) {
    const record: unknown = entry;
    if (!isMatching(TextCatalogPattern, record)) continue;
    for (const parsed of record.data.items) {
      const item: MaskedItem = { entryId: parsed.entryId, toolName: parsed.toolName, path: parsed.path };
      if (parsed.archiveId !== undefined) item.archiveId = parsed.archiveId;
      if (parsed.text !== undefined) item.text = parsed.text;
      let recovered = false;
      if (item.archiveId === undefined && item.text === undefined && SHA_PATTERN.test(item.entryId)) {
        legacy ??= legacyRollingRecords(branch);
        for (const source of legacy.get(item.path) ?? []) {
          if (source.archiveId !== item.entryId || source.toolName !== item.toolName) continue;
          items.set(source.entryId, { ...item, ...source });
          recovered = true;
        }
      }
      if (!recovered) items.set(item.entryId, item);
    }
  }
  return items;
}

/** Applies the existing source-entry or content-address provenance rule used by recall. */
export function recallableTextArchiveRecords(branch: readonly SessionEntry[]): MaskedItem[] {
  const sources = new Map<string, string>();
  for (const entry of branch) {
    if (entry.type === "message" && entry.message.role === "toolResult")
      sources.set(entry.id, entry.message.toolName);
  }
  return [...savedItems(branch).values()].filter((item) => {
    if (sources.get(item.entryId) === item.toolName) return true;
    if (typeof item.text !== "string" || item.text.length > MAX_TEXT_ARCHIVE_BYTES) return false;
    return createHash("sha256").update(item.text).digest("hex") === item.entryId;
  });
}

export async function readTextArtifact(
  root: string,
  record: Pick<MaskedItem, "path" | "entryId" | "text" | "archiveId">,
  bytes: number,
) {
  return readSavedArtifact(root, record, bytes);
}

/** Resolves checkpoint paths only through the branch's validated text catalog. */
export async function readTextArchiveReference(
  root: string,
  records: ReadonlyMap<string, MaskedItem>,
  path: string,
  bytes: number,
) {
  let record: MaskedItem | undefined;
  for (const candidate of records.values()) {
    if (candidate.path === path) record = candidate;
  }
  if (!record) throw Error("Checkpoint address is not in the session catalogue");
  return { record, ...(await readTextArtifact(root, record, bytes)) };
}

export function isImageArchiveEntry(entry: SessionEntry): boolean {
  return entry.type === "custom" && entry.customType === IMAGE_ARCHIVE;
}

/** Returns only structurally valid image catalog records; file identity is checked on every read. */
export function imageArchiveRecords(entry: SessionEntry): ImageArchiveRecord[] | undefined {
  if (entry.type !== "custom" || entry.customType !== IMAGE_ARCHIVE) return undefined;
  const data: unknown = entry.data;
  if (!isMatching(ImageArchiveEntryPattern, data)) return undefined;
  return data.images;
}

/** Reads the latest compaction's image decisions, preserving its existing first-compaction boundary. */
export function checkpointImages(branch: readonly SessionEntry[]): ImageArchiveRecord[] {
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index];
    if (entry?.type !== "compaction") continue;
    const details: unknown = entry.details;
    if (isMatching(ImageArchiveEntryPattern, details)) return details.images;
    return [];
  }
  return [];
}
