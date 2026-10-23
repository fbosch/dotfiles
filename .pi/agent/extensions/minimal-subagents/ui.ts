import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { installMainWindowRendererAccess } from "./main-window-renderers";
import type { ChildObservation } from "./driver";
import type { ParentRuntime } from "./parent-runtime";
import { SubagentOverlay } from "./overlay";
import { agentName, type AgentAppearance } from "./rendering";
import { createWorkerWidget } from "./widget";
import { SubagentTranscriptFrame } from "../prompt-ui/subagent-transcript-frame";

export function createWorkerUI(ctx: ExtensionContext, runtime: ParentRuntime, observation: (id: string) => ChildObservation | undefined, maxRows = 4, appearance: AgentAppearance = new Map()) {
  let redrawWidget = () => {};
  let widget: ReturnType<typeof createWorkerWidget> | undefined;
  let overlay: SubagentOverlay | undefined;
  let closeOverlay: (() => void) | undefined;
  let opening = false;
  let disposed = false;
  const refresh = () => { if (!disposed) { redrawWidget(); overlay?.refresh(); } };
  const unsubscribe = runtime.delivery.owner.subscribe(refresh);
  const unsubscribePresentation = runtime.delivery.subscribePresentation(refresh);
  if (ctx.mode === "tui") {
    ctx.ui.setWidget("minimal-subagents", (tui, theme) => {
      widget?.dispose();
      redrawWidget = () => tui.requestRender();
      widget = createWorkerWidget(() => ({
        workers: runtime.delivery.owner.list(), observation, terminalRows: tui.terminal.rows,
        maxRows, hiddenWorkers: runtime.delivery.foregroundWorkerIds(), theme,
        agentName: (name) => agentName(name, theme, appearance),
      }), theme, (workerId) => {
        void ui.open(workerId).catch((error: unknown) => ctx.ui.notify(`Unable to open worker output: ${String(error)}`, "error"));
      }, () => tui.requestRender());
      return widget;
    }, { placement: "aboveEditor" });
  }
  const ui = {
    refresh,
    async open(workerId?: string): Promise<void> {
      if (disposed) return;
      if (ctx.mode !== "tui") throw new Error("Subagent inspection requires the terminal interface");
      if (workerId !== undefined) runtime.delivery.owner.inspect(workerId);
      if (opening) {
        if (workerId !== undefined) overlay?.inspect(workerId);
        return;
      }
      opening = true;
      try {
        const rendererLookup = installMainWindowRendererAccess();
        await ctx.ui.custom<void>((tui, theme, _keys, done) => {
          closeOverlay = () => done();
          overlay = new SubagentOverlay(runtime, {
            observation, theme, appearance, tui, cwd: ctx.cwd, height: () => Math.max(5, Math.floor(tui.terminal.rows * 0.8) - 2),
            getToolRenderers: rendererLookup(tui),
            requestRender: () => tui.requestRender(), close: () => done(),
            confirm: (title, message) => ctx.ui.confirm(title, message),
          });
          if (workerId !== undefined) overlay.inspect(workerId);
          return new SubagentTranscriptFrame(overlay, theme, "Subagents");
        }, { overlay: true, overlayOptions: { width: "90%", maxHeight: "80%", anchor: "center" } });
      } finally {
        overlay?.dispose();
        overlay = undefined;
        closeOverlay = undefined;
        opening = false;
      }
    },
    dispose(): void {
      disposed = true;
      unsubscribe();
      unsubscribePresentation();
      overlay?.dispose();
      closeOverlay?.();
      widget?.dispose();
      widget = undefined;
      redrawWidget = () => {};
      if (ctx.mode === "tui") ctx.ui.setWidget("minimal-subagents", undefined);
    },
  };
  return ui;
}
