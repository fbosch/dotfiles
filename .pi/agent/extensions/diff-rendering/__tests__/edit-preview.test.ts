import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { theme } from "@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { createDiffEditTool } from "../edit-preview";
import type { DiffDetails, EditDiffRequest, EditDiffRunner } from "../shared";

initTheme("dark", false);

for (const failure of ["missing file", "unmatched edit", "renderer failure"] as const) {
  test(`failed native edit preview settles until arguments change: ${failure}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-edit-preview-"));
    const controllers = new Set<AbortController>();
    const requests: EditDiffRequest[] = [];
    let rejectRenderer = failure === "renderer failure";
    const run: EditDiffRunner = async (request) => {
      requests.push(request);
      if (rejectRenderer) throw new Error("Preview render failed");
      const details: DiffDetails = {
        display: "inline",
        noChanges: false,
        output: "after",
        scope: "edit changes",
        width: 100,
      };
      return details;
    };
    const tool = createDiffEditTool(root, run, controllers);
    const renderCall = tool.renderCall;
    if (renderCall === undefined) throw new Error("Edit call renderer is unavailable");
    type Context = Parameters<typeof renderCall>[2];
    const state: Context["state"] = {
      expandedPreview: undefined,
      expandedPreviewController: undefined,
      expandedPreviewKey: undefined,
      expandedPreviewPending: false,
      preview: undefined,
      previewController: undefined,
      previewFailed: false,
      previewKey: undefined,
      previewPending: false,
      previewRequest: undefined,
    };
    const args = {
      path: failure === "missing file" ? "missing.txt" : "sample.txt",
      edits: [{ oldText: failure === "unmatched edit" ? "absent" : "before", newText: "after" }],
    };
    let notify: (() => void) | undefined;
    const context: Context = {
      args,
      argsComplete: true,
      cwd: root,
      executionStarted: false,
      expanded: false,
      invalidate: () => {
        if (state.previewPending === false) notify?.();
      },
      isError: false,
      durationMs: undefined,
      outputPad: 1,
      isPartial: false,
      lastComponent: undefined,
      showImages: false,
      state,
      toolCallId: "preview-test",
    };
    const settled = (render: () => void) =>
      new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Preview did not settle")), 1000);
        notify = () => {
          clearTimeout(timeout);
          notify = undefined;
          resolve();
        };
        try {
          render();
        } catch (error) {
          clearTimeout(timeout);
          notify = undefined;
          reject(error);
        }
      });

    try {
      await writeFile(join(root, "sample.txt"), "before\n");
      await settled(() => renderCall(args, theme, context));
      const attempts = requests.length;
      expect(attempts).toBe(failure === "renderer failure" ? 1 : 0);
      for (let redraw = 0; redraw < 3; redraw++) renderCall(args, theme, context);
      expect(state.previewPending).toBe(false);
      expect(state.previewController).toBeUndefined();
      expect(controllers.size).toBe(0);
      expect(requests).toHaveLength(attempts);

      rejectRenderer = false;
      const changed = { path: "sample.txt", edits: [{ oldText: "before", newText: "fixed" }] };
      context.args = changed;
      await settled(() => renderCall(changed, theme, context));
      expect(requests).toHaveLength(attempts + 1);
      expect(requests.at(-1)?.newContent).toBe("fixed\n");
      expect(state.preview?.output).toBe("after");
      renderCall(changed, theme, context);
      expect(requests).toHaveLength(attempts + 1);
    } finally {
      for (const controller of controllers) controller.abort();
      await rm(root, { recursive: true, force: true });
    }
  });
}
