import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

export const MAX_IMAGE_BYTES = 4_000_000;
export const MAX_INSPECTION_IMAGES = 32;
export const MAX_INSPECTION_BYTES = 16_000_000;
export const IMAGE_PROCESSING_TIMEOUT_MS = 15_000;
export class ImageProcessorUnavailableError extends Error {}
export type ImageInspectionJob = { bytes: Buffer; mimeType: string };
export type ImageInspectionResult = { ok: true } | { ok: false; error: Error };
type Decoder = ChildProcessByStdio<Writable, Readable, Readable>;

export async function inspectImageBatch(
  jobs: readonly ImageInspectionJob[],
  spawnWorker: () => Decoder,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ImageInspectionResult[]> {
  const { signal, timeoutMs = IMAGE_PROCESSING_TIMEOUT_MS } = options;
  const aborted = () => Object.assign(new Error("Image processing was aborted"), { name: "AbortError" });
  if (signal?.aborted) throw aborted();
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid image processing timeout");
  if (jobs.length > MAX_INSPECTION_IMAGES || jobs.some(job => !job.bytes.length || job.bytes.length > MAX_IMAGE_BYTES) ||
      jobs.reduce((total, job) => total + job.bytes.length, 0) > MAX_INSPECTION_BYTES)
    throw new Error("Image inspection batch exceeds its limits");
  const results: ImageInspectionResult[] = [];
  while (results.length < jobs.length) {
    if (signal?.aborted) throw aborted();
    const completed = await new Promise<ImageInspectionResult[]>((resolve, reject) => {
      let child: Decoder;
      try { child = spawnWorker(); }
      catch { reject(new ImageProcessorUnavailableError("Sharp image processor could not be started")); return; }
      const batch: ImageInspectionResult[] = [];
      const decoder = new StringDecoder("utf8");
      let pending = "";
      let timer: ReturnType<typeof setTimeout> | undefined;
      let failure: Error | undefined;
      let fatal: Error | undefined;
      const stop = (error: Error, global = false) => {
        if (failure) return;
        failure = error;
        if (global) fatal = error;
        child.kill("SIGKILL");
      };
      const send = () => {
        if (timer) clearTimeout(timer);
        const index = results.length + batch.length;
        const job = jobs[index];
        if (!job) {
          timer = setTimeout(() => stop(new Error("Image decoder did not exit")), timeoutMs);
          timer.unref?.();
          child.stdin.end();
          return;
        }
        // Only one image is in flight, so failures cannot invalidate already acknowledged images.
        timer = setTimeout(() => stop(new Error("Image processing timed out")), timeoutMs);
        timer.unref?.();
        child.stdin.write(JSON.stringify({ index, mimeType: job.mimeType, data: job.bytes.toString("base64") }) + "\n");
      };
      const onAbort = () => stop(aborted(), true);
      signal?.addEventListener("abort", onAbort, { once: true });
      child.stdin.on("error", () => {});
      child.stderr.on("data", () => {});
      child.on("error", () => stop(new ImageProcessorUnavailableError("Sharp image processor could not be started"), true));
      child.stdout.on("data", (part: Buffer) => {
        if (failure) return;
        pending += decoder.write(part);
        if (Buffer.byteLength(pending) > 1_024) { stop(new Error("Invalid image inspection response")); return; }
        const end = pending.indexOf("\n");
        if (end < 0) return;
        let value: unknown;
        try { value = JSON.parse(pending.slice(0, end)); }
        catch { stop(new Error("Invalid image inspection response")); return; }
        pending = pending.slice(end + 1);
        if (pending || typeof value !== "object" || value === null ||
            results.length + batch.length >= jobs.length || !("index" in value) || value.index !== results.length + batch.length ||
            !("ok" in value) || typeof value.ok !== "boolean" ||
            (!value.ok && (!("error" in value) || typeof value.error !== "string"))) {
          stop(new Error("Invalid image inspection response")); return;
        }
        batch.push(value.ok ? { ok: true } : {
          ok: false, error: new Error("error" in value && typeof value.error === "string"
            ? value.error.replace(/\p{Cc}/gu, " ").slice(0, 512) : "Image validation failed"),
        });
        send();
      });
      child.on("close", (code: number | null) => {
        pending += decoder.end();
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (signal?.aborted) { reject(aborted()); return; }
        if (fatal) { reject(fatal); return; }
        if (code === 2) { reject(new ImageProcessorUnavailableError("Sharp image processor is unavailable")); return; }
        if (results.length + batch.length < jobs.length) {
          // A killed or crashed decoder loses only its current image; restart for the remaining queue.
          batch.push({ ok: false, error: failure ?? new Error("Image decoder stopped before completing the image") });
        } else if (failure || code !== 0 || pending) {
          reject(new ImageProcessorUnavailableError(failure?.message ?? "Invalid image inspection completion")); return;
        }
        resolve(batch);
      });
      if (signal?.aborted) onAbort();
      else send();
    });
    results.push(...completed);
  }
  return results;
}
