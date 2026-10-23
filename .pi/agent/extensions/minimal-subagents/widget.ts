import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { isInspectClick } from "./interaction";
import { widgetLines } from "./presentation";
import { frameWidget } from "./rendering";

export function createWorkerWidget(
  options: () => Omit<Parameters<typeof widgetLines>[0], "width" | "onWorkerRows">,
  theme: Theme,
  open: (workerId: string) => void,
  requestRender?: (frame: number) => void,
  clock: { setInterval(callback: () => void, delay: number): ReturnType<typeof setInterval>; clearInterval(id: ReturnType<typeof setInterval>): void } = globalThis,
  otherActivity: () => boolean = () => false,
): Component & { dispose(): void } {
  let targets = new Map<number, string>();
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  const stop = () => { if (timer) clock.clearInterval(timer); timer = undefined; };
  return {
    render(width) {
      targets = new Map();
      const state = options();
      let visibleRunning = false;
      const running = new Set(state.workers.filter((worker) => worker.status === "running").map((worker) => worker.id));
      const lines = widgetLines({
        ...state, activityFrame: frame, width: Math.max(1, width - (width >= 5 ? 4 : 0)),
        onWorkerRows(workerId, start, end) {
          if (width >= 9 && running.has(workerId)) visibleRunning = true;
          // The dock frame adds one row above the content.
          for (let row = start; row < end; row++) targets.set(row + 1, workerId);
        },
      });
      if ((!visibleRunning && !otherActivity()) || disposed) stop();
      else if (!timer && requestRender) {
        timer = clock.setInterval(() => { if (!disposed) { frame++; requestRender(frame); } }, 200);
      }
      return frameWidget(lines, width, theme);
    },
    invalidate() { targets.clear(); },
    dispose() { disposed = true; stop(); targets.clear(); },
    handleMouse(event) {
      if (disposed || !isInspectClick(event)) return;
      const workerId = targets.get(event.y);
      if (!workerId) return;
      open(workerId);
      return { handled: true, render: false };
    },
  };
}
