import type { Component, TuiMouseEvent } from "@earendil-works/pi-tui";
import { isMatching, P } from "ts-pattern";

export interface WorkerTarget {
  workerId: string;
  parentSessionId?: string;
}
export type OpenWorker = (target: WorkerTarget) => void;
export interface WorkerRenderState {
  target?: WorkerTarget;
  hasResult?: boolean;
}

export function isInspectClick(event: TuiMouseEvent): boolean {
  return (
    event.type === "click" && event.button === "left" && !event.shift && !event.alt && !event.ctrl
  );
}

/** Leave presses and drags to Pi's selection handling; only a completed click opens output. */
export function inspectable(
  component: Component,
  target: () => WorkerTarget | undefined,
  open?: OpenWorker,
): Component {
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
  if (!isMatching({ workerId: P.string }, worker)) return;
  return {
    workerId: worker.workerId,
    ...(isMatching({ parentSessionId: P.string }, worker)
      ? { parentSessionId: worker.parentSessionId }
      : {}),
  };
}

export function resultWorkerTarget(result: {
  content: readonly { type: string; text?: string }[];
}): WorkerTarget | undefined {
  const text = result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
  try {
    return workerTarget(JSON.parse(text));
  } catch {
    return undefined;
  }
}
