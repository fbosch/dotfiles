import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { isAbsolute } from "node:path";
import { isMatching, P } from "ts-pattern";

const chunkBytes = 32 * 1024;
const maxBytes = 32 * 1024 * 1024;
const maxFrameBytes = 65536;

type ImageChunk = { imageId: string; offset: number; totalBytes: number; data: string };

function sendChunk(endpoint: string, params: ImageChunk): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const socket = createConnection(endpoint);
    let received = Buffer.alloc(0);
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(10000, () => fail(new Error("The image broker did not respond.")));
    socket.once("error", () => fail(new Error("Could not connect to the image broker.")));
    socket.once("connect", () =>
      socket.write(`${JSON.stringify({ id, method: "image.open", params })}\n`),
    );
    socket.on("data", (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      if (received.length > maxFrameBytes) return fail(new Error("Invalid image broker response."));
      const newline = received.indexOf(10);
      if (newline < 0) return;
      try {
        const response: unknown = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(received.subarray(0, newline)),
        );
        if (!isMatching({ id, ok: true, result: { complete: P.boolean } }, response)) {
          return fail(new Error("The desktop broker rejected the image."));
        }
        settled = true;
        socket.destroy();
        resolve(response.result.complete);
      } catch {
        fail(new Error("Invalid image broker response."));
      }
    });
    socket.once("close", () =>
      fail(new Error("The image broker closed without acknowledging the request.")),
    );
  });
}

export async function openImageWithBroker(endpoint: string, png: Buffer): Promise<void> {
  if (!isAbsolute(endpoint) || Buffer.byteLength(endpoint) > 103)
    throw new Error("Invalid image broker socket.");
  if (png.length === 0 || png.length > maxBytes)
    throw new Error("Image exceeds the broker limit of 32 MiB.");
  const imageId = randomUUID();
  const deadline = Date.now() + 55000;
  for (let offset = 0; offset < png.length; offset += chunkBytes) {
    if (Date.now() > deadline) throw new Error("Image upload timed out.");
    const bytes = png.subarray(offset, Math.min(offset + chunkBytes, png.length));
    const complete = await sendChunk(endpoint, {
      imageId,
      offset,
      totalBytes: png.length,
      data: bytes.toString("base64"),
    });
    if (complete !== (offset + bytes.length === png.length))
      throw new Error("Invalid image broker acknowledgement.");
  }
}
