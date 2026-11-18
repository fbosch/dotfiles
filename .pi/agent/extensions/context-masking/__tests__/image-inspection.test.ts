import { expect, test } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { inspectImageBatch, ImageProcessorUnavailableError, MAX_IMAGE_BYTES } from "../image-inspection";

function fixture(modes: number[]) {
  const children: ChildProcessWithoutNullStreams[] = [];
  const jobs = modes.map(mode => ({ bytes: Buffer.from([mode]), mimeType: "image/png" }));
  const factory = () => {
    const child = spawn(process.execPath, [new URL("./fixtures/inspection-worker.cjs", import.meta.url).pathname],
      { stdio: ["pipe", "pipe", "pipe"], cwd: "/", env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent" } });
    children.push(child);
    return child;
  };
  return { children, jobs, factory };
}

test("one decoder acknowledges valid images and isolates a rejected image", async () => {
  const f = fixture([0, 1, 0]);
  const result = await inspectImageBatch(f.jobs, f.factory);
  expect(result.map(item => item.ok)).toEqual([true, false, true]);
  expect(result[1]?.ok === false && result[1].error.message).toBe("bad pixels");
  expect(f.children).toHaveLength(1);
});

for (const mode of [2, 3, 4, 7]) {
  test(`decoder failure mode ${mode} loses only its current image and restarts the queue`, async () => {
    const f = fixture([0, mode, 0]);
    const result = await inspectImageBatch(f.jobs, f.factory, { timeoutMs: 500 });
    expect(result.map(item => item.ok)).toEqual([true, false, true]);
    expect(f.children).toHaveLength(2);
    expect(f.children.every(child => child.exitCode !== null || child.signalCode !== null)).toBe(true);
  }, 5_000);
}

test("cancellation terminates the decoder without starting another queue", async () => {
  const f = fixture([3, 0]);
  const controller = new AbortController();
  const result = inspectImageBatch(f.jobs, f.factory, { signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  expect(f.children).toHaveLength(1);
  expect(f.children[0]?.exitCode !== null || f.children[0]?.signalCode !== null).toBe(true);
});

test("an unavailable processor rejects the batch rather than skipping its images", async () => {
  const f = fixture([5, 0]);
  await expect(inspectImageBatch(f.jobs, f.factory)).rejects.toBeInstanceOf(ImageProcessorUnavailableError);
  expect(f.children).toHaveLength(1);
});

test("the process deadline still applies after the last acknowledgement", async () => {
  const f = fixture([6]);
  await expect(inspectImageBatch(f.jobs, f.factory, { timeoutMs: 500 })).rejects.toThrow("did not exit");
});

test("batch limits reject oversized input before launching a process", async () => {
  const f = fixture(Array(33).fill(0));
  await expect(inspectImageBatch(f.jobs, f.factory)).rejects.toThrow("limits");
  await expect(inspectImageBatch([{ bytes: Buffer.alloc(MAX_IMAGE_BYTES + 1), mimeType: "image/png" }], f.factory)).rejects.toThrow("limits");
  await expect(inspectImageBatch(Array.from({ length: 5 }, () => ({ bytes: Buffer.alloc(MAX_IMAGE_BYTES), mimeType: "image/png" })), f.factory)).rejects.toThrow("limits");
  expect(f.children).toHaveLength(0);
});
