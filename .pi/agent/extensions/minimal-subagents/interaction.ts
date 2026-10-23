import type { Component, TuiMouseEvent } from "@earendil-works/pi-tui";

export interface WorkerTarget { workerId: string; parentSessionId?: string; }
export type OpenWorker = (target: WorkerTarget) => void;
export interface WorkerRenderState { target?: WorkerTarget; }

export function isInspectClick(event: TuiMouseEvent): boolean {
  return event.type === "click" && event.button === "left" && !event.shift && !event.alt && !event.ctrl;
}

/** Leave presses and drags to Pi's selection handling; only a completed click opens output. */
export function inspectable(component: Component, target: () => WorkerTarget | undefined, open?: OpenWorker): Component {
  if (!open) return component;
  return {
    render: (width) => component.render(width),
    invalidate: () => component.invalidate(),
    handleMouse(event) {
      if (!isInspectClick(event)) return component.handleMouse?.(event);
      const worker = target();
      if (!worker) return component.handleMouse?.(event);
      open(worker);
      return { handled: true, render: false };
    },
  };
}

export function workerTarget(value: unknown): WorkerTarget | undefined {
  if (typeof value !== "object" || value === null) return;
  const worker = "worker" in value ? value.worker : value;
  if (typeof worker !== "object" || worker === null || !("workerId" in worker) || typeof worker.workerId !== "string") return;
  return { workerId: worker.workerId, ...("parentSessionId" in worker && typeof worker.parentSessionId === "string" ? { parentSessionId: worker.parentSessionId } : {}) };
}

export function resultWorkerTarget(result: { content: readonly { type: string; text?: string }[] }): WorkerTarget | undefined {
  const text = result.content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n");
  try { return workerTarget(JSON.parse(text)); } catch { return undefined; }
}
