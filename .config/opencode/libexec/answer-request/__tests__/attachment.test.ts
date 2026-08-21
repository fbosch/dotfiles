import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
  answerRequestLimits,
  createOpenCodeFilePart,
  validateAttachments,
  type AttachmentDescriptor,
} from "../index.js";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("attachment integrity", () => {
  test("retains verified PNG bytes and builds the OpenCode file part from them", async () => {
    await withTemporaryDirectory(async (directory) => {
      const descriptor = await writeAttachment(directory, "capture.png", onePixelPng, "image/png");
      const result = await validateAttachments([descriptor]);

      assert.equal(result.isOk(), true);
      if (result.isErr()) return;
      const attachment = result.value[0];
      assert.ok(attachment);
      assert.equal(attachment.width, 1);
      assert.equal(attachment.height, 1);
      assert.deepEqual(attachment.bytes, onePixelPng);

      const part = createOpenCodeFilePart(attachment, 0);
      assert.equal(part.type, "file");
      assert.equal(part.mime, "image/png");
      assert.equal(part.filename, "attachment-1.png");
      assert.deepEqual(Buffer.from(part.url.split(",", 2)[1] ?? "", "base64"), onePixelPng);
      assert.equal(part.url.includes(descriptor.path), false);
    });
  });

  test("accepts JPEG dimensions from a start-of-frame segment", async () => {
    await withTemporaryDirectory(async (directory) => {
      const jpeg = createJpeg(640, 480);
      const descriptor = await writeAttachment(directory, "capture.jpg", jpeg, "image/jpeg");
      const result = await validateAttachments([descriptor]);

      assert.equal(result.isOk(), true);
      if (result.isErr()) return;
      assert.equal(result.value[0]?.width, 640);
      assert.equal(result.value[0]?.height, 480);
    });
  });

  test("rejects symlinks and non-regular files", async () => {
    await withTemporaryDirectory(async (directory) => {
      const target = join(directory, "capture.png");
      const link = join(directory, "capture-link.png");
      await writeFile(target, onePixelPng);
      await symlink(target, link);
      await mkdir(join(directory, "capture-directory"));

      const symlinkResult = await validateAttachments([
        descriptorFor(link, onePixelPng, "image/png"),
      ]);
      const directoryResult = await validateAttachments([
        descriptorFor(join(directory, "capture-directory"), onePixelPng, "image/png"),
      ]);

      assert.equal(symlinkResult.isErr() && symlinkResult.error.code, "attachment_invalid");
      assert.equal(directoryResult.isErr() && directoryResult.error.code, "attachment_invalid");
    });
  });

  test("rejects a FIFO without blocking", async () => {
    await withTemporaryDirectory(async (directory) => {
      const path = join(directory, "capture.png");
      const created = spawnSync("mkfifo", [path]);
      assert.equal(created.status, 0);

      const result = await validateAttachments([
        descriptorFor(path, onePixelPng, "image/png"),
      ]);
      assert.equal(result.isErr() && result.error.code, "attachment_invalid");
    });
  });

  test("rejects changed digests, MIME mismatches, and invalid magic bytes", async () => {
    await withTemporaryDirectory(async (directory) => {
      const png = await writeAttachment(directory, "capture.png", onePixelPng, "image/png");
      const jpegBytes = createJpeg(1, 1);
      const jpeg = await writeAttachment(directory, "capture.jpg", jpegBytes, "image/png");
      const invalid = await writeAttachment(
        directory,
        "capture-invalid.png",
        Buffer.from("not an image"),
        "image/png",
      );

      const changed = await validateAttachments([{ ...png, sha256: "0".repeat(64) }]);
      const mismatch = await validateAttachments([jpeg]);
      const invalidMagic = await validateAttachments([invalid]);

      assert.equal(changed.isErr() && changed.error.code, "attachment_changed");
      assert.equal(mismatch.isErr() && mismatch.error.code, "attachment_invalid");
      assert.equal(invalidMagic.isErr() && invalidMagic.error.code, "attachment_invalid");
      assert.equal(JSON.stringify(changed).includes(png.path), false);
    });
  });

  test("rejects excessive dimensions and pixel counts", async () => {
    await withTemporaryDirectory(async (directory) => {
      const tooWide = createPngHeader(answerRequestLimits.imageDimensionPixels + 1, 1);
      const tooManyPixels = createPngHeader(8192, 8192);
      const wideDescriptor = await writeAttachment(directory, "wide.png", tooWide, "image/png");
      const pixelsDescriptor = await writeAttachment(
        directory,
        "pixels.png",
        tooManyPixels,
        "image/png",
      );

      const wide = await validateAttachments([wideDescriptor]);
      const pixels = await validateAttachments([pixelsDescriptor]);
      assert.equal(wide.isErr() && wide.error.code, "attachment_too_large");
      assert.equal(pixels.isErr() && pixels.error.code, "attachment_too_large");
    });
  });

  test("rejects individual, aggregate, and count limits", async () => {
    await withTemporaryDirectory(async (directory) => {
      const individualBytes = paddedPng(answerRequestLimits.attachmentBytes + 1);
      const individual = await writeAttachment(
        directory,
        "individual.png",
        individualBytes,
        "image/png",
      );
      const individualResult = await validateAttachments([individual]);
      assert.equal(
        individualResult.isErr() && individualResult.error.code,
        "attachment_too_large",
      );

      const aggregateSize = Math.floor(answerRequestLimits.aggregateAttachmentBytes / 2) + 1;
      const first = await writeAttachment(
        directory,
        "aggregate-1.png",
        paddedPng(aggregateSize),
        "image/png",
      );
      const second = await writeAttachment(
        directory,
        "aggregate-2.png",
        paddedPng(aggregateSize),
        "image/png",
      );
      const aggregateResult = await validateAttachments([first, second]);
      assert.equal(
        aggregateResult.isErr() && aggregateResult.error.code,
        "attachment_too_large",
      );

      const countResult = await validateAttachments(
        Array.from({ length: answerRequestLimits.attachmentCount + 1 }, () => first),
      );
      assert.equal(countResult.isErr() && countResult.error.code, "attachment_too_large");
    });
  });
});

async function withTemporaryDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "answer-request-test-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function writeAttachment(
  directory: string,
  name: string,
  bytes: Uint8Array,
  mimeType: AttachmentDescriptor["mimeType"],
): Promise<AttachmentDescriptor> {
  const path = join(directory, name);
  await writeFile(path, bytes);
  return descriptorFor(path, bytes, mimeType);
}

function descriptorFor(
  path: string,
  bytes: Uint8Array,
  mimeType: AttachmentDescriptor["mimeType"],
): AttachmentDescriptor {
  return {
    path,
    mimeType,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function createPngHeader(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  onePixelPng.copy(bytes, 0, 0, 16);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function paddedPng(size: number): Buffer {
  const bytes = Buffer.alloc(size);
  onePixelPng.copy(bytes);
  return bytes;
}

function createJpeg(width: number, height: number): Buffer {
  return Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
    0xff,
    0xd9,
  ]);
}
