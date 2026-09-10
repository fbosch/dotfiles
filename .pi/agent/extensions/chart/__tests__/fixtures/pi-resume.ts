import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setCapabilities, setCellDimensions } from "@earendil-works/pi-tui";
import chartExtension from "../../index";
import { LazyChartComponent } from "../../lazy";

export default function (pi: ExtensionAPI): void {
  chartExtension(pi);
  pi.on("session_start", (event, ctx) => {
    const reportPath = process.env.PI_CHART_RESUME_REPORT;
    assert.ok(reportPath);
    const report = (status: string) => {
      appendFileSync(reportPath, `${JSON.stringify({ reason: event.reason, status })}\n`);
    };
    const restored = ctx.sessionManager
      .getBranch()
      .filter((entry) => entry.type === "message" && entry.message.role === "toolResult");
    assert.equal(restored.length, 32, "must resume saved tool results, not an empty session");
    setCellDimensions({ widthPx: 16, heightPx: 38 });
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    const original = LazyChartComponent.prototype.render;
    const completed = new WeakSet<LazyChartComponent>();
    // Observe Pi's actual restored transcript, without prewarming or replacing the rasterizer.
    LazyChartComponent.prototype.render = function (width) {
      const lines = original.call(this, width);
      if (!completed.has(this)) {
        if (lines.some((line) => line.includes("unavailable"))) {
          completed.add(this);
          report("unavailable");
        } else if (lines.some((line) => line.includes("\x1b_G"))) {
          completed.add(this);
          report("image");
        }
      }
      return lines;
    };
    report("started");
  });
}
