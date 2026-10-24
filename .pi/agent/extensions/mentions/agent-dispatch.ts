import type {
  ToolCallEvent,
  ToolCallEventResult,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";

const coordinationTools = new Set([
  "codemode",
  "tasks",
  "ask_user_question",
  "subagent_result",
  "subagent_control",
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function envelope(event: ToolResultEvent): Record<string, unknown> | undefined {
  const first = event.content[0];
  if (first?.type !== "text") return;
  try {
    const value: unknown = JSON.parse(first.text);
    return record(value) ? value : undefined;
  } catch {
    return;
  }
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function receipt(value: Record<string, unknown>, specialist: string) {
  if (value.kind === "launched") {
    if (!identifier(value.workerId) || !identifier(value.assignmentId)) return;
    return { workerId: value.workerId, completed: false };
  }
  if (value.kind !== "completed" && value.kind !== "question") return;
  if (!record(value.worker) || !record(value.assignment)) return;
  const { worker, assignment } = value;
  if (
    !identifier(worker.workerId) ||
    worker.specialist !== specialist ||
    !identifier(assignment.assignmentId)
  )
    return;
  if (value.kind === "completed") {
    if (assignment.outcome !== "completed" || typeof value.report !== "string") return;
  } else {
    if (
      assignment.outcome !== "waiting-question" ||
      !record(value.question) ||
      !identifier(value.question.id) ||
      !identifier(value.question.text) ||
      value.question.workerId !== worker.workerId ||
      value.question.assignmentId !== assignment.assignmentId
    )
      return;
  }
  return { workerId: worker.workerId, completed: value.kind === "completed" };
}

interface Dispatch {
  pending: Set<string>;
  calls: Map<string, string>;
  workers: Set<string>;
  canInspect: boolean;
}

/** Request-scoped launch ordering, not a permission or sandbox boundary. */
export class MentionDispatch {
  private current: Dispatch | undefined;

  begin(names: readonly string[]): void {
    this.current =
      names.length === 0
        ? undefined
        : {
            pending: new Set(names),
            calls: new Map(),
            workers: new Set(),
            canInspect: false,
          };
  }

  reset(): void {
    this.current = undefined;
  }

  before(event: ToolCallEvent): ToolCallEventResult | undefined {
    const current = this.current;
    if (!current) return;
    if (event.toolName === "subagent") {
      const input: unknown = event.input;
      if (
        !record(input) ||
        typeof input.specialist !== "string" ||
        !current.pending.has(input.specialist)
      ) {
        return {
          block: true,
          reason: `Launch the requested specialists: ${[...current.pending].map((name) => `@${name}`).join(", ")}.`,
        };
      }
      current.calls.set(event.toolCallId, input.specialist);
      return;
    }
    if (current.canInspect || coordinationTools.has(event.toolName)) return;
    return {
      block: true,
      reason: `Launch ${[...current.pending].map((name) => `@${name}`).join(", ")} before inspecting files. Use the supplied specialist metadata, or ask the user to clarify the assignment.`,
    };
  }

  after(event: ToolResultEvent): void {
    const current = this.current;
    if (!current || event.isError) return;
    if (event.toolName === "subagent") {
      const name = current.calls.get(event.toolCallId);
      current.calls.delete(event.toolCallId);
      if (!name) return;
      const value = envelope(event);
      const accepted = value && receipt(value, name);
      if (!accepted) return;
      current.workers.add(accepted.workerId);
      current.pending.delete(name);
      if (accepted.completed) current.canInspect = true;
      if (current.pending.size === 0) this.reset();
      return;
    }
    const request: unknown = event.input.request;
    if (
      event.toolName !== "subagent_result" ||
      !record(request) ||
      typeof request.workerId !== "string" ||
      !current.workers.has(request.workerId)
    )
      return;
    if (request.mode === "report") {
      // A successful report retrieval means the runner has evidence for parent verification.
      current.canInspect = true;
    } else if (request.mode === "wait") {
      const value = envelope(event);
      if (
        value?.kind === "completed" &&
        record(value.worker) &&
        value.worker.workerId === request.workerId
      )
        current.canInspect = true;
    }
  }
}
