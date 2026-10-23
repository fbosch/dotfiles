import { assignmentPrompt, parentNarrative } from "./context";
import { WorkerDelivery, workerStatus } from "./delivery";
import type { AssignmentOverrides, ResolvedSpecialist } from "./specialist";

export interface ParentLaunch extends AssignmentOverrides {
  specialist: string;
  prompt: string;
  foreground?: boolean;
  inheritContext?: boolean;
}

export type ParentInspection =
  | { mode: "status"; workerId?: string }
  | { mode: "report"; workerId: string; assignmentId?: string }
  | { mode: "transcript"; workerId: string; assignmentId?: string; offset?: number; limit?: number }
  | { mode: "wait"; workerId: string; assignmentId: string; timeoutMs?: number };

export type ParentControl =
  | { action: "continue"; workerId: string; prompt: string; maxTurns?: number }
  | { action: "reply"; workerId: string; assignmentId: string; questionId: string; text: string }
  | { action: "steer"; workerId: string; assignmentId: string; text: string }
  | { action: "extend-budget"; workerId: string; assignmentId: string; additionalTurns: number }
  | { action: "cancel" | "release"; workerId: string };

/** Tools, routed commands, and UI controls share this parent-scoped interface. */
export class ParentRuntime {
  constructor(readonly delivery: WorkerDelivery, private readonly context: {
    resolve: (name: string, overrides: AssignmentOverrides) => Promise<ResolvedSpecialist>;
    messages: () => readonly unknown[];
  }) {}

  async launch(request: ParentLaunch, signal?: AbortSignal, onProgress?: (status: ReturnType<typeof workerStatus>) => void) {
    if (signal?.aborted) throw new Error("Launch interrupted before preflight");
    const overrides: AssignmentOverrides = {
      ...(request.model === undefined ? {} : { model: request.model }),
      ...(request.thinking === undefined ? {} : { thinking: request.thinking }),
      ...(request.maxTurns === undefined ? {} : { maxTurns: request.maxTurns }),
    };
    const config = await this.context.resolve(request.specialist, overrides);
    if (signal?.aborted) throw new Error("Launch interrupted during preflight");
    const prompt = assignmentPrompt(request.prompt, request.inheritContext ? parentNarrative(this.context.messages()) : undefined);
    return this.delivery.launch({ config, prompt, ...(request.maxTurns === undefined ? {} : { maxTurns: request.maxTurns }) }, {
      ...(request.foreground === undefined ? {} : { foreground: request.foreground }),
      ...(onProgress ? { onProgress } : {}),
      ...(signal ? { signal } : {}),
    });
  }

  inspect(request: ParentInspection, signal?: AbortSignal) {
    const owner = this.delivery.owner;
    switch (request.mode) {
      case "status": return request.workerId ? workerStatus(owner.inspect(request.workerId)) : owner.list().map(workerStatus);
      case "report": return owner.report(request.workerId, request.assignmentId);
      case "transcript": return owner.transcript(request.workerId, {
        ...(request.assignmentId === undefined ? {} : { assignmentId: request.assignmentId }),
        ...(request.offset === undefined ? {} : { offset: request.offset }),
        ...(request.limit === undefined ? {} : { limit: request.limit }),
      });
      case "wait": return this.delivery.wait(request.workerId, request.assignmentId, {
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
        ...(signal ? { signal } : {}),
      });
    }
  }

  async control(request: ParentControl) {
    const owner = this.delivery.owner;
    const worker = owner.inspect(request.workerId);
    if ("assignmentId" in request && request.assignmentId !== worker.currentAssignmentId) {
      throw new Error("Control refers to a non-current assignment");
    }
    switch (request.action) {
      case "continue": return this.delivery.continue(request.workerId, request.prompt, request.maxTurns);
      case "reply": return workerStatus(await owner.reply(request.workerId, request.questionId, request.text));
      case "steer":
        await owner.steer(request.workerId, request.text);
        return workerStatus(owner.inspect(request.workerId));
      case "extend-budget": return workerStatus(await owner.extendBudget(request.workerId, request.assignmentId, request.additionalTurns));
      case "cancel": return workerStatus(await owner.cancel(request.workerId));
      case "release": return workerStatus(await owner.release(request.workerId));
    }
  }

  shutdown(): Promise<void> { return this.delivery.shutdown(); }
}
