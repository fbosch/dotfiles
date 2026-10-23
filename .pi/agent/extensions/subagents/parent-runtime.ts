import { match } from "ts-pattern";
import { assignmentPrompt, parentNarrative } from "./context";
import { type WorkerDelivery, workerStatus } from "./delivery";
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
  constructor(
    readonly delivery: WorkerDelivery,
    private readonly context: {
      resolve: (name: string, overrides: AssignmentOverrides) => Promise<ResolvedSpecialist>;
      messages: () => readonly unknown[];
    },
  ) {}

  async launch(
    request: ParentLaunch,
    signal?: AbortSignal,
    onProgress?: (status: ReturnType<typeof workerStatus>) => void,
  ) {
    if (signal?.aborted) throw new Error("Launch interrupted before preflight");
    const overrides: AssignmentOverrides = {
      ...(request.model === undefined ? {} : { model: request.model }),
      ...(request.thinking === undefined ? {} : { thinking: request.thinking }),
      ...(request.maxTurns === undefined ? {} : { maxTurns: request.maxTurns }),
    };
    const config = await this.context.resolve(request.specialist, overrides);
    if (signal?.aborted) throw new Error("Launch interrupted during preflight");
    const prompt = assignmentPrompt(
      request.prompt,
      request.inheritContext ? parentNarrative(this.context.messages()) : undefined,
    );
    return this.delivery.launch(
      { config, prompt, ...(request.maxTurns === undefined ? {} : { maxTurns: request.maxTurns }) },
      {
        ...(request.foreground === undefined ? {} : { foreground: request.foreground }),
        ...(onProgress ? { onProgress } : {}),
        ...(signal ? { signal } : {}),
      },
    );
  }

  inspect(request: ParentInspection, signal?: AbortSignal) {
    const owner = this.delivery.owner;
    return match(request)
      .with({ mode: "status" }, ({ workerId }) =>
        workerId ? workerStatus(owner.inspect(workerId)) : owner.list().map(workerStatus),
      )
      .with({ mode: "report" }, ({ workerId, assignmentId }) =>
        owner.report(workerId, assignmentId),
      )
      .with({ mode: "transcript" }, ({ workerId, assignmentId, offset, limit }) =>
        owner.transcript(workerId, {
          ...(assignmentId === undefined ? {} : { assignmentId }),
          ...(offset === undefined ? {} : { offset }),
          ...(limit === undefined ? {} : { limit }),
        }),
      )
      .with({ mode: "wait" }, ({ workerId, assignmentId, timeoutMs }) =>
        this.delivery.wait(workerId, assignmentId, {
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
          ...(signal ? { signal } : {}),
        }),
      )
      .exhaustive();
  }

  async control(request: ParentControl) {
    const owner = this.delivery.owner;
    const worker = owner.inspect(request.workerId);
    if ("assignmentId" in request && request.assignmentId !== worker.currentAssignmentId) {
      throw new Error("Control refers to a non-current assignment");
    }
    return match(request)
      .with({ action: "continue" }, ({ workerId, prompt, maxTurns }) =>
        this.delivery.continue(workerId, prompt, maxTurns),
      )
      .with({ action: "reply" }, async ({ workerId, questionId, text }) =>
        workerStatus(await owner.reply(workerId, questionId, text)),
      )
      .with({ action: "steer" }, async ({ workerId, text }) => {
        await owner.steer(workerId, text);
        return workerStatus(owner.inspect(workerId));
      })
      .with({ action: "extend-budget" }, async ({ workerId, assignmentId, additionalTurns }) =>
        workerStatus(await owner.extendBudget(workerId, assignmentId, additionalTurns)),
      )
      .with({ action: "cancel" }, async ({ workerId }) =>
        workerStatus(await owner.cancel(workerId)),
      )
      .with({ action: "release" }, async ({ workerId }) =>
        workerStatus(await owner.release(workerId)),
      )
      .exhaustive();
  }

  shutdown(): Promise<void> {
    return this.delivery.shutdown();
  }
}
