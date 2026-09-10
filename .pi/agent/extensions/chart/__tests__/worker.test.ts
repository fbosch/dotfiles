import { describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getPngDimensions } from "@earendil-works/pi-tui";
import { rasterizeSvg, shutdownRasterizer } from "../types";

const execFileAsync = promisify(execFile);
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="red"/></svg>';
const cwd = new URL("../../../", import.meta.url).pathname;

async function nodeProbe(source: string, preload?: string): Promise<string> {
  const { stdout, stderr } = await execFileAsync(
    "node",
    [...(preload === undefined ? [] : ["--require", preload]), "--input-type=module", "-e", source],
    { cwd, timeout: 15_000 },
  );
  expect(stderr).toBe("");
  return stdout.trim();
}

const loadRuntime = `
  import { createJiti } from "jiti";
  const jiti = createJiti(import.meta.url);
  const runtime = await jiti.import("./extensions/chart/types.ts");
  const svg = ${JSON.stringify(svg)};
`;

describe("chart raster worker", () => {
  test("renders real PNGs under Bun and recovers after a renderer error", async () => {
    await expect(rasterizeSvg("not svg")).rejects.toThrow();
    expect(getPngDimensions(await rasterizeSvg(svg))).toEqual({ widthPx: 64, heightPx: 32 });
    shutdownRasterizer();
    expect(getPngDimensions(await rasterizeSvg(svg))).toEqual({ widthPx: 64, heightPx: 32 });
  });

  test("renders through Node/jiti and lets the idle worker exit naturally", async () => {
    const png = await nodeProbe(`${loadRuntime}
      console.log(await runtime.rasterizeSvg(svg));
    `);
    expect(getPngDimensions(png)).toEqual({ widthPx: 64, heightPx: 32 });
  });

  test("starts lazily, reuses one worker, and keeps Node timers responsive through all CPU stages", async () => {
    const output = await nodeProbe(
      `
      import assert from "node:assert/strict";
      import threads from "node:worker_threads";
      import { syncBuiltinESMExports } from "node:module";
      let workers = 0;
      const OriginalWorker = threads.Worker;
      threads.Worker = class extends OriginalWorker {
        constructor(...args) { super(...args); workers++; }
      };
      syncBuiltinESMExports();
      ${loadRuntime}
      assert.equal(workers, 0);
      await assert.rejects(runtime.rasterizeSvg(svg, AbortSignal.abort()), { name: "AbortError" });
      await assert.rejects(runtime.rasterizeSvg("x".repeat(65537)), /resource limit/);
      assert.equal(workers, 0);
      await runtime.rasterizeSvg(svg);
      assert.equal(workers, 1);
      let ticks = 0;
      let previous = performance.now();
      let maxGap = 0;
      const timer = setInterval(() => {
        const now = performance.now();
        maxGap = Math.max(maxGap, now - previous);
        previous = now;
        ticks++;
      }, 5);
      const start = performance.now();
      assert.equal(await runtime.rasterizeSvg(svg), "cG5n");
      maxGap = Math.max(maxGap, performance.now() - previous);
      clearInterval(timer);
      assert.equal(workers, 1);
      assert.ok(ticks > 20, String(ticks));
      assert.ok(maxGap < 150, String(maxGap));
      console.log(JSON.stringify({ ticks, maxGap, duration: performance.now() - start }));
      `,
      new URL("./fixtures/slow-resvg.cjs", import.meta.url).pathname,
    );
    const measurement = JSON.parse(output) as { ticks: number; maxGap: number; duration: number };
    expect(measurement.duration).toBeGreaterThanOrEqual(600);
    expect(measurement.maxGap).toBeLessThan(150);
  }, 15_000);

  test("cancels active and queued work promptly, coalesces resize jobs, and restarts after shutdown", async () => {
    const output = await nodeProbe(
      `${loadRuntime}
      import assert from "node:assert/strict";
      await runtime.rasterizeSvg(svg);
      const controller = new AbortController();
      const active = runtime.rasterizeSvg(svg, controller.signal);
      const rejected = assert.rejects(active, { name: "AbortError" });
      await new Promise(resolve => setTimeout(resolve, 30));
      const key = {};
      const stale = runtime.rasterizeSvg(svg, undefined, { coalesceKey: key });
      const staleRejected = assert.rejects(stale, { name: "AbortError" });
      const latest = runtime.rasterizeSvg(svg, undefined, { coalesceKey: key });
      const cancelled = new AbortController();
      const queued = runtime.rasterizeSvg(svg, cancelled.signal);
      const queuedRejected = assert.rejects(queued, { name: "AbortError" });
      const start = performance.now();
      cancelled.abort();
      controller.abort();
      await Promise.all([rejected, queuedRejected, staleRejected]);
      const latency = performance.now() - start;
      assert.ok(latency < 150, String(latency));
      assert.equal(await latest, "cG5n");
      await assert.rejects(runtime.rasterizeSvg(svg, undefined, { timeoutMs: 20 }), /timed out/);
      runtime.shutdownRasterizer();
      assert.equal(await runtime.rasterizeSvg(svg), "cG5n");
      await assert.rejects(runtime.rasterizeSvg("oversized"), /chart PNG exceeded the resource limit/);
      await assert.rejects(runtime.rasterizeSvg("exit"), /worker exited/);
      assert.equal(await runtime.rasterizeSvg(svg), "cG5n");
      runtime.shutdownRasterizer();
      runtime.shutdownRasterizer();
      console.log(JSON.stringify({ latency }));
      `,
      new URL("./fixtures/slow-resvg.cjs", import.meta.url).pathname,
    );
    expect((JSON.parse(output) as { latency: number }).latency).toBeLessThan(150);
  }, 15_000);
});
