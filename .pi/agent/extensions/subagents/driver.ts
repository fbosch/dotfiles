import type {
  AgentSession,
  ExtensionContext,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { match, P } from "ts-pattern";
import { Type } from "typebox";
import { type ChildSessionOptions, createChildSession } from "./child-session";
import {
  type ChildDriver,
  type ChildDriverCallbacks,
  type ChildExecutionOutcome,
  type ChildPromptInput,
  type ChildRunInput,
  ChildStartupFailedError,
  UnconfirmedChildStartupError,
} from "./owner";
import type { ResolvedSpecialist } from "./specialist";

type ChildHandle = Awaited<ReturnType<typeof createChildSession>>;

export interface ChildObservation {
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly activity: string;
  readonly liveText: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cost?: number;
  readonly resolvedModel?: string | undefined;
  readonly resolvedThinking?: AgentSession["thinkingLevel"] | undefined;
}

interface Segment {
  readonly input: ChildRunInput;
  readonly callbacks: ChildDriverCallbacks;
  used: number;
  exhausted: boolean;
  question: boolean;
  warn: boolean;
  lastReport: string;
  error?: string;
}

interface LiveChild {
  building?: Promise<ChildHandle>;
  child?: ChildHandle;
  segment?: Segment;
  running?: Promise<ChildExecutionOutcome>;
  closing?: Promise<{ confirmed: boolean; diagnostic?: string }>;
  cancelled: boolean;
  uncertain: boolean;
  retained: readonly unknown[];
}

function textBlocks(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((block: unknown) =>
      match(block)
        .with({ type: "text", text: P.string }, ({ text }) => [text])
        .otherwise(() => []),
    )
    .join("\n");
}

/** A teardown grace never limits ordinary assignment execution. Timeout means uncertainty, not success. */
async function confirmWithin<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Child shutdown did not settle within the confirmation grace")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function runtimeModelDetails(
  session: Pick<AgentSession, "model" | "thinkingLevel" | "routedModel">,
): Pick<ChildObservation, "resolvedModel" | "resolvedThinking"> {
  const route = session.routedModel;
  if (route)
    return {
      resolvedModel: `${route.model.provider}/${route.model.id}`,
      resolvedThinking: route.thinkingLevel,
    };
  // Virtual selections resolve on a successful response; the alias is not a physical model.
  const selected = session.model;
  if (!selected || selected.api === "pi-virtual")
    return { resolvedModel: undefined, resolvedThinking: undefined };
  return {
    resolvedModel: `${selected.provider}/${selected.id}`,
    resolvedThinking: session.thinkingLevel,
  };
}
export class PiChildDriver implements ChildDriver {
  private readonly children = new Map<string, LiveChild>();
  private readonly observations = new Map<string, ChildObservation>();

  constructor(
    private readonly options: {
      cwd: string;
      agentDir: string;
      projectTrusted: boolean;
      resolveModel: (
        config: ResolvedSpecialist,
      ) => NonNullable<ExtensionContext["model"]> | undefined;
      retainUncertain: (workerId: string, resources: readonly unknown[]) => void;
      changed?: (workerId: string) => void;
      shutdownGraceMs?: number;
      create?: (options: ChildSessionOptions) => Promise<ChildHandle>;
    },
  ) {}

  observation(workerId: string): ChildObservation | undefined {
    return this.observations.get(workerId);
  }

  async start(
    input: ChildRunInput,
    callbacks: ChildDriverCallbacks,
  ): Promise<ChildExecutionOutcome> {
    if (this.children.has(input.workerId)) throw new Error("Child already exists");
    const model = this.options.resolveModel(input.config);
    if (!model)
      throw new ChildStartupFailedError(`Required model is unavailable: ${input.config.model}`);
    const record: LiveChild = { cancelled: false, uncertain: false, retained: [] };
    this.children.set(input.workerId, record);
    this.observations.set(input.workerId, {
      startedAt: Date.now(),
      activity: "Starting",
      liveText: "",
    });
    record.building = (this.options.create ?? createChildSession)({
      config: input.config,
      cwd: this.options.cwd,
      agentDir: this.options.agentDir,
      projectTrusted: this.options.projectTrusted,
      model,
      protocol: this.protocol(input.workerId, record),
      onUncertainStartup: (_error, resources) => {
        record.uncertain = true;
        record.retained = resources;
        this.options.retainUncertain(input.workerId, resources);
      },
    });
    try {
      record.child = await record.building;
      this.observeSession(input.workerId, record, record.child.session);
      return await this.run(record, input, callbacks);
    } catch (error) {
      if (record.uncertain) throw new UnconfirmedChildStartupError(String(error));
      if (!record.child) {
        this.children.delete(input.workerId);
        throw new ChildStartupFailedError(String(error));
      }
      throw error;
    }
  }

  async prompt(
    input: ChildPromptInput,
    callbacks: ChildDriverCallbacks,
  ): Promise<ChildExecutionOutcome> {
    const record = this.require(input.workerId);
    if (!record.child || record.cancelled || record.closing)
      throw new Error("Child session cannot continue");
    return this.run(record, input, callbacks);
  }

  async steer(workerId: string, text: string): Promise<void> {
    const record = this.require(workerId);
    const child = record.child ?? (await record.building);
    if (!child || record.cancelled) throw new Error("Child session is not available for steering");
    await child.session.steer(text);
  }

  async abort(workerId: string): Promise<void> {
    const record = this.require(workerId);
    record.cancelled = true;
    try {
      await confirmWithin(
        (async () => {
          const child = record.child ?? (await record.building);
          if (child) await child.session.abort();
        })(),
        this.options.shutdownGraceMs ?? 5_000,
      );
    } catch (error) {
      record.uncertain = true;
      this.options.retainUncertain(workerId, [record]);
      throw error;
    }
  }

  async close(workerId: string): Promise<{ confirmed: boolean; diagnostic?: string }> {
    const record = this.children.get(workerId);
    if (!record) return { confirmed: true };
    if (record.uncertain)
      return { confirmed: false, diagnostic: "Child cleanup remains unconfirmed" };
    record.cancelled = true;
    record.closing ??= (async () => {
      try {
        await confirmWithin(
          (async () => {
            const child = record.child ?? (await record.building);
            if (child) await child.close();
            if (record.running) await record.running;
          })(),
          this.options.shutdownGraceMs ?? 5_000,
        );
        this.children.delete(workerId);
        return { confirmed: true };
      } catch (error) {
        record.uncertain = true;
        this.options.retainUncertain(workerId, [record]);
        return { confirmed: false, diagnostic: String(error) };
      }
    })();
    return record.closing;
  }

  private require(workerId: string): LiveChild {
    const record = this.children.get(workerId);
    if (!record) throw new Error("Child session is not available");
    return record;
  }

  private change(workerId: string, update: Partial<ChildObservation>): void {
    const observation = this.observations.get(workerId);
    if (observation) this.observations.set(workerId, { ...observation, ...update });
    this.options.changed?.(workerId);
  }

  private protocol(workerId: string, record: LiveChild): ExtensionFactory {
    return (pi) => {
      pi.registerTool({
        name: "worker_question",
        label: "Ask parent",
        description: "Ask one blocking question, then yield until the parent replies.",
        parameters: Type.Object({ question: Type.String({ minLength: 1 }) }),
        async execute(_id, args) {
          const segment = record.segment;
          if (!segment || segment.question)
            throw new Error("No active assignment or a question is already pending");
          segment.question = true;
          segment.callbacks.onQuestion(args.question);
          return {
            content: [{ type: "text", text: "Question sent; this assignment is paused." }],
            details: undefined,
            terminate: true,
          };
        },
      });
      pi.registerTool({
        name: "worker_update",
        label: "Update parent",
        description:
          "Send a material finding or blocker to the parent. Do not report routine tool activity.",
        parameters: Type.Object({ text: Type.String({ minLength: 1 }) }),
        async execute(_id, args) {
          if (!record.segment || record.cancelled) throw new Error("No active assignment");
          record.segment.callbacks.onUpdate(args.text);
          return { content: [{ type: "text", text: "Update sent." }], details: undefined };
        },
      });
      pi.on("turn_start", (_event, ctx) => {
        const segment = record.segment;
        if (!segment) {
          ctx.abort();
          return;
        }
        const ceiling = segment.input.turnsAlreadyUsed + segment.input.turnBudget;
        if (segment.used >= ceiling || segment.question || record.cancelled) {
          segment.exhausted = !segment.question && !record.cancelled;
          ctx.abort();
          return;
        }
        segment.warn = ceiling - segment.used <= segment.input.wrapUpAtRemaining;
        segment.used++;
        segment.callbacks.onTurn(segment.used);
      });
      pi.on("context", (event) => {
        const segment = record.segment;
        if (!segment?.warn) return;
        segment.warn = false;
        const remaining =
          segment.input.turnsAlreadyUsed + segment.input.turnBudget - segment.used + 1;
        const warning = `${remaining} turn(s) remain, including this one. Finish the bounded assignment and return findings, checks, and unfinished work.`;
        segment.callbacks.onTranscript({ role: "system", text: warning });
        return {
          messages: [
            ...event.messages,
            { role: "user" as const, content: warning, timestamp: Date.now() },
          ],
        };
      });
      pi.on("tool_call", () => {
        if (record.cancelled || record.segment?.question)
          return { block: true, reason: "Worker execution is stopping" };
      });
      pi.on("session_shutdown", () => {
        this.change(workerId, { activity: "Stopped", liveText: "" });
      });
    };
  }

  private observeSession(workerId: string, record: LiveChild, session: AgentSession): void {
    session.subscribe((event) => {
      const segment = record.segment;
      if (!segment) return;
      match(event)
        .with(
          {
            type: "message_update",
            message: { role: "assistant" },
            assistantMessageEvent: { type: "text_delta" },
          },
          ({ message }) =>
            this.change(workerId, { liveText: textBlocks(message.content), activity: "Writing" }),
        )
        .with({ type: "tool_execution_start" }, ({ toolName }) =>
          this.change(workerId, { activity: toolName }),
        )
        .with({ type: "message_end" }, ({ message }) =>
          this.recordMessage(workerId, segment, session, message),
        )
        // SDK lifecycle events outside these observation cases do not change worker evidence.
        .otherwise(() => undefined);
    });
  }

  private recordMessage(
    workerId: string,
    segment: Segment,
    session: AgentSession,
    message: AgentSession["messages"][number],
  ): void {
    const role = match(message.role)
      .with("toolResult", () => "tool" as const)
      .with("user", "assistant", (role) => role)
      .otherwise(() => "system" as const);
    segment.callbacks.onTranscript({ role, text: JSON.stringify(message) });
    if (message.role === "assistant") {
      const report = textBlocks(message.content);
      if (report) segment.lastReport = report;
      match(message.stopReason)
        .with("error", "length", () => {
          segment.error = message.errorMessage ?? `Provider stopped with ${message.stopReason}`;
        })
        .with("aborted", () => undefined)
        .with("pending", "stop", "toolUse", "deferred", () => {
          delete segment.error;
        })
        .exhaustive();
      if (message.stopReason !== "error" && message.stopReason !== "aborted") {
        const previous = this.observations.get(workerId);
        this.change(workerId, {
          ...runtimeModelDetails(session),
          inputTokens: (previous?.inputTokens ?? 0) + message.usage.input,
          outputTokens: (previous?.outputTokens ?? 0) + message.usage.output,
          cost: (previous?.cost ?? 0) + message.usage.cost.total,
        });
      }
    }
    this.change(workerId, { liveText: "" });
  }

  private run(
    record: LiveChild,
    input: ChildRunInput,
    callbacks: ChildDriverCallbacks,
  ): Promise<ChildExecutionOutcome> {
    if (record.segment) throw new Error("Child execution segment is already active");
    const child = record.child;
    if (!child) throw new Error("Child startup has not completed");
    const segment: Segment = {
      input,
      callbacks,
      used: input.turnsAlreadyUsed,
      exhausted: false,
      question: false,
      warn: false,
      lastReport: "",
    };
    record.segment = segment;
    this.change(input.workerId, {
      ...runtimeModelDetails(child.session),
      activity: "Running",
      liveText: "",
    });
    record.running = (async (): Promise<ChildExecutionOutcome> => {
      try {
        if (!record.cancelled)
          await child.session.sendUserMessage(input.prompt, { expandPromptTemplates: false });
        await child.session.agent.waitForIdle();
        return match({
          waiting: segment.question && !record.cancelled,
          exhausted: segment.exhausted,
          failed: record.cancelled || Boolean(segment.error),
        })
          .returnType<ChildExecutionOutcome>()
          .with({ waiting: true }, () => ({ kind: "waiting-question", turnsUsed: segment.used }))
          .with({ waiting: false, exhausted: true }, () => ({
            kind: "budget-exhausted",
            turnsUsed: segment.used,
            partialReport: segment.lastReport,
          }))
          .with({ waiting: false, exhausted: false, failed: true }, () => ({
            kind: "failed",
            turnsUsed: segment.used,
            error: segment.error ?? "Worker cancelled",
            partialReport: segment.lastReport,
          }))
          .with({ waiting: false, exhausted: false, failed: false }, () => ({
            kind: "completed",
            turnsUsed: segment.used,
            report: segment.lastReport,
          }))
          .exhaustive();
      } catch (error) {
        return {
          kind: "failed",
          turnsUsed: segment.used,
          error: String(error),
          partialReport: segment.lastReport,
        };
      } finally {
        delete record.segment;
        this.change(input.workerId, {
          ...runtimeModelDetails(child.session),
          endedAt: Date.now(),
          activity: segment.question ? "Waiting for parent" : "Settled",
          liveText: "",
        });
      }
    })();
    return record.running;
  }
}
