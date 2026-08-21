import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { FilePartInput } from "@opencode-ai/sdk/v2";
import { err, ok, type Result } from "neverthrow";
import {
  answerRequestLimits,
  type AttachmentDescriptor,
} from "./protocol.js";

export interface VerifiedAttachment {
  mimeType: "image/png" | "image/jpeg";
  bytes: Uint8Array;
  sha256: string;
  width: number;
  height: number;
}

export type AttachmentValidationError = {
  code: "attachment_invalid" | "attachment_too_large" | "attachment_changed";
};

type ImageMetadata = Pick<VerifiedAttachment, "mimeType" | "width" | "height">;

const pngSignature = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

export async function validateAttachments(
  descriptors: readonly AttachmentDescriptor[],
): Promise<Result<VerifiedAttachment[], AttachmentValidationError>> {
  if (descriptors.length > answerRequestLimits.attachmentCount) {
    return fail("attachment_too_large");
  }

  const attachments: VerifiedAttachment[] = [];
  let aggregateBytes = 0;

  for (const descriptor of descriptors) {
    const remainingBytes = answerRequestLimits.aggregateAttachmentBytes - aggregateBytes;
    const result = await validateAttachment(descriptor, remainingBytes);
    if (result.isErr()) return err(result.error);
    attachments.push(result.value);
    aggregateBytes += result.value.bytes.byteLength;
  }

  return ok(attachments);
}

export function createOpenCodeFilePart(
  attachment: VerifiedAttachment,
  index: number,
): FilePartInput {
  const extension = attachment.mimeType === "image/png" ? "png" : "jpg";
  return {
    type: "file",
    mime: attachment.mimeType,
    filename: `attachment-${index + 1}.${extension}`,
    url: `data:${attachment.mimeType};base64,${Buffer.from(attachment.bytes).toString("base64")}`,
  };
}

async function validateAttachment(
  descriptor: AttachmentDescriptor,
  remainingAggregateBytes: number,
): Promise<Result<VerifiedAttachment, AttachmentValidationError>> {
  let file: FileHandle | undefined;
  try {
    file = await open(
      descriptor.path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const initialStat = await file.stat();
    if (initialStat.isFile() === false || initialStat.size <= 0) {
      return fail("attachment_invalid");
    }
    if (
      initialStat.size > answerRequestLimits.attachmentBytes ||
      initialStat.size > remainingAggregateBytes
    ) {
      return fail("attachment_too_large");
    }

    const bytes = await readBoundedFile(file, initialStat.size);
    const finalStat = await file.stat();
    if (bytes.byteLength !== initialStat.size || finalStat.size !== initialStat.size) {
      return fail("attachment_changed");
    }

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== descriptor.sha256) return fail("attachment_changed");

    const metadata = readImageMetadata(bytes);
    if (metadata === null || metadata.mimeType !== descriptor.mimeType) {
      return fail("attachment_invalid");
    }
    if (
      metadata.width > answerRequestLimits.imageDimensionPixels ||
      metadata.height > answerRequestLimits.imageDimensionPixels ||
      metadata.width * metadata.height > answerRequestLimits.imagePixels
    ) {
      return fail("attachment_too_large");
    }

    return ok({ ...metadata, bytes, sha256 });
  } catch {
    return fail("attachment_invalid");
  } finally {
    await file?.close().catch(() => undefined);
  }
}

async function readBoundedFile(file: FileHandle, expectedBytes: number): Promise<Uint8Array> {
  const bytes = Buffer.allocUnsafe(expectedBytes + 1);
  let offset = 0;

  while (offset < bytes.byteLength) {
    const result = await file.read(bytes, offset, bytes.byteLength - offset, offset);
    if (result.bytesRead === 0) break;
    offset += result.bytesRead;
  }

  return bytes.subarray(0, offset);
}

function readImageMetadata(bytes: Uint8Array): ImageMetadata | null {
  if (matchesPrefix(bytes, pngSignature)) return readPngMetadata(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return readJpegMetadata(bytes);
  return null;
}

function readPngMetadata(bytes: Uint8Array): ImageMetadata | null {
  if (bytes.byteLength < 33) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13) return null;
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return null;

  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) return null;
  return { mimeType: "image/png", width, height };
}

function readJpegMetadata(bytes: Uint8Array): ImageMetadata | null {
  let offset = 2;

  while (offset < bytes.byteLength) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.byteLength) return null;

    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.byteLength) return null;

    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) return null;
    if (isStartOfFrame(marker)) {
      if (segmentLength < 8) return null;
      const componentCount = bytes[offset + 7];
      if (componentCount === 0 || segmentLength !== 8 + 3 * componentCount) return null;
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      if (width === 0 || height === 0) return null;
      return { mimeType: "image/jpeg", width, height };
    }
    offset += segmentLength;
  }

  return null;
}

function isStartOfFrame(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

function matchesPrefix(bytes: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function fail(
  code: AttachmentValidationError["code"],
): Result<never, AttachmentValidationError> {
  return err({ code });
}
