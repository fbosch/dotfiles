import type { Component } from "@earendil-works/pi-tui";
import { isMatching } from "ts-pattern";
import type { workerStatus } from "./delivery";
import { resultWorkerTarget, type WorkerTarget, workerTarget } from "./interaction";

type Status = ReturnType<typeof workerStatus> & { prompt?: string; report?: string };
export type WorkerLookup = (target: WorkerTarget) => Status | undefined;
type Result = { content: readonly { type: string; text?: string }[] };
type RenderContext = { toolCallId: string; invalidate: () => void; isError?: boolean };

/** One display owner per worker; tool results and saved evidence remain immutable. */
export class LaunchCards {
  private readonly views = new Map<string, { workerId: string; invalidate: () => void }>();
  private readonly primary = new Map<string, { callId: string; parentSessionId?: string }>();
  private readonly running = new Set<string>();
  private activityFrame = 0;
  active(): boolean {
    return this.running.size > 0;
  }
  animate(frame: number): void {
    this.activityFrame = frame;
    for (const id of [...this.running]) this.views.get(id)?.invalidate();
  }
  constructor(private readonly lookup?: WorkerLookup) {}

  current(target: WorkerTarget | undefined): Status | undefined {
    if (!target) return;
    const found = this.lookup?.(target);
    return found?.workerId === target.workerId &&
      (target.parentSessionId === undefined || found.parentSessionId === target.parentSessionId)
      ? found
      : undefined;
  }

  has(target: WorkerTarget | undefined): boolean {
    if (!target) return false;
    const primary = this.primary.get(target.workerId);
    return (
      primary !== undefined &&
      (target.parentSessionId === undefined || primary.parentSessionId === target.parentSessionId)
    );
  }

  wrap(
    component: Component,
    target: () => WorkerTarget | undefined,
    context: RenderContext,
    hideList: () => boolean = () => false,
  ): Component {
    const hidden = () => {
      const worker = target();
      return (
        !context.isError &&
        (hideList() ||
          (worker !== undefined &&
            this.has(worker) &&
            this.primary.get(worker.workerId)?.callId !== context.toolCallId))
      );
    };
    return {
      render: (width) => (hidden() ? [] : component.render(width)),
      invalidate: () => component.invalidate(),
      handleMouse: (event) => (hidden() ? undefined : component.handleMouse?.(event)),
    };
  }

  statusList<T extends Result>(result: T): { result: T; hidden: boolean } | undefined {
    let values: unknown;
    try {
      values = JSON.parse(
        result.content
          .filter((block) => block.type === "text")
          .map((block) => block.text ?? "")
          .join("\n"),
      );
    } catch {
      return;
    }
    if (!Array.isArray(values) || values.length === 0) return;
    const remaining = values.filter((value) => !this.has(workerTarget(value)));
    return {
      result: { ...result, content: [{ type: "text", text: JSON.stringify(remaining) }] },
      hidden: remaining.length === 0,
    };
  }
  project<T extends Result>(result: T, context: RenderContext, fallbackTarget?: WorkerTarget): T {
    if (context.isError) {
      this.running.delete(context.toolCallId);
      return result;
    }
    const target = resultWorkerTarget(result) ?? fallbackTarget;
    if (!target) return result;
    const worker = this.current(target);
    this.views.set(context.toolCallId, {
      workerId: target.workerId,
      invalidate: context.invalidate,
    });
    if (!this.primary.has(target.workerId))
      this.primary.set(target.workerId, {
        callId: context.toolCallId,
        ...((worker?.parentSessionId ?? target.parentSessionId)
          ? { parentSessionId: worker?.parentSessionId ?? target.parentSessionId }
          : {}),
      });
    if (this.primary.get(target.workerId)?.callId === context.toolCallId) {
      if (worker?.state === "running") this.running.add(context.toolCallId);
      else this.running.delete(context.toolCallId);
    }
    if (!worker) {
      // Completed evidence remains useful when the owning runtime is no longer available.
      try {
        const data: unknown = JSON.parse(
          result.content
            .filter((block) => block.type === "text")
            .map((block) => block.text ?? "")
            .join("\n"),
        );
        if (!isMatching({ kind: "launched" }, data)) return result;
      } catch {
        return result;
      }
    }
    const assignment = worker?.assignments.find(
      (item) => item.assignmentId === worker.currentAssignmentId,
    );
    const display =
      worker && assignment
        ? {
            worker,
            assignment,
            activityFrame: this.activityFrame,
            ...(worker.state === "queued" || worker.state === "running"
              ? { kind: "launched" }
              : {}),
            ...(worker.report ? { report: worker.report } : {}),
          }
        : { state: "Launch accepted", preview: "Current assignment status unavailable" };
    return { ...result, content: [{ type: "text", text: JSON.stringify(display) }] };
  }

  refresh(workerId?: string): void {
    // Invalidation rerenders and registers the same rows again.
    for (const view of [...this.views.values()])
      if (workerId === undefined || view.workerId === workerId) view.invalidate();
  }

  clear(): void {
    this.views.clear();
    this.primary.clear();
    this.running.clear();
    this.activityFrame = 0;
  }
}
