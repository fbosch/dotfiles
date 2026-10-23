import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveNamedSpecialist } from "./catalog";
import { WorkerDelivery, workerStatus, type WorkerNotice } from "./delivery";
import { PiChildDriver } from "./driver";
import { processCleanupHealth } from "./health";
import { parentHistory, restoreHistory } from "./history";
import { WorkerOwner, type ChildDriver } from "./owner";
import { ParentRuntime } from "./parent-runtime";
import { registerParentTools } from "./tools";
import { createWorkerUI } from "./ui";
import { loadAgentMentions } from "../mentions/agent-mentions";
import { renderNotice, type AgentAppearance } from "./rendering";
import { workerTarget, resultWorkerTarget, type OpenWorker } from "./interaction";

export function hasUnsettledWorkers(runtime: ParentRuntime): boolean {
  return runtime.delivery.owner.list().some((worker) =>
    worker.status === "queued" || worker.status === "running" || worker.status === "waiting-question"
    || worker.status === "stopping" || worker.status === "cleanup-unknown" || worker.status === "releasing");
}

export interface HostDependencies {
  createDriver?: (options: ConstructorParameters<typeof PiChildDriver>[0]) => ChildDriver & Pick<PiChildDriver, "observation">;
  resolve?: typeof resolveNamedSpecialist;
  health?: ReturnType<typeof processCleanupHealth>;
  runtimeChanged?: (runtime: ParentRuntime | undefined) => void;
}
/** Explicit factory until coordinated cutover installs the discovery entry point. */
export function registerSubagentHost(pi: ExtensionAPI, options: { agentDir?: string; widgetRows?: number } = {}, dependencies: HostDependencies = {}): void {
  const agentDir = options.agentDir ?? getAgentDir();
  const health = dependencies.health ?? processCleanupHealth();
  let context: ExtensionContext | undefined;
  let current: { parentId: string; runtime: ParentRuntime; ui: ReturnType<typeof createWorkerUI> } | undefined;
  let shuttingDown = false;
  let unsubscribeCards = () => {};
  let appearance: AgentAppearance = new Map();
  let updateDeliverySequence = 0;
  const pendingUpdateDeliveries = new Map<string, { parentId: string; notice: Extract<WorkerNotice, { type: "update" }> }>();

  const getRuntime = (ctx: ExtensionContext): ParentRuntime => {
    if (shuttingDown) throw new Error("Subagent runtime is shutting down");
    const parentId = ctx.sessionManager.getSessionId();
    if (current && current.parentId !== parentId) throw new Error("Previous parent runtime has not shut down");
    context = ctx;
    if (current) return current.runtime;
    if (ctx.mode === "tui") appearance = new Map(loadAgentMentions(ctx.cwd, agentDir, ctx.isProjectTrusted()).map((agent) => [agent.name, agent]));
    const saved = restoreHistory(ctx.sessionManager.getEntries(), parentId);
    const driver = (dependencies.createDriver ?? ((driverOptions) => new PiChildDriver(driverOptions)))({
      cwd: ctx.cwd, agentDir, projectTrusted: ctx.isProjectTrusted(),
      resolveModel: (config) => ctx.modelRegistry.getAvailable().find((model) => `${model.provider}/${model.id}` === config.model),
      retainUncertain: (workerId, resources) => health.retain(workerId, resources),
      changed: () => current?.ui.refresh(),
    });
    const persistence = parentHistory({
      parentSessionId: parentId,
      currentParentId: () => context?.sessionManager.getSessionId() ?? "",
      parentFile: () => ctx.sessionManager.getSessionFile(),
      append: (type, data) => pi.appendEntry(type, data),
      observation: (id) => driver.observation(id),
    });
    const owner = new WorkerOwner({ parentSessionId: parentId, driver, persistence,
      historicalWorkers: saved.map((entry) => entry.worker),
      cleanupHealth: {
        isBlocked: () => health.isBlocked(),
        markUncertain(diagnostic) {
          health.markUncertain(diagnostic);
          health.retain(`owner:${parentId}`, [owner, driver]);
        },
      },
    });
    const delivery = new WorkerDelivery(owner, (notice) => {
      if (context?.sessionManager.getSessionId() !== parentId || shuttingDown) return;
      const assignment = notice.type === "completion" || notice.type === "storage-failure"
        ? owner.inspect(notice.worker.workerId).assignments.find((item) => item.id === notice.assignment.assignmentId) : undefined;
      const preview = (assignment?.report ?? assignment?.partialReport ?? "").split("\n").slice(0, 30).join("\n").slice(0, 4000);
      if (notice.type === "update") {
        const updateDeliveryId = `${parentId}:${++updateDeliverySequence}`;
        pendingUpdateDeliveries.set(updateDeliveryId, { parentId, notice });
        pi.sendMessage({
          customType: "minimal-subagents.notice", content: JSON.stringify(notice),
          details: { preview, updateDeliveryId }, display: !cards.has(workerTarget(notice)),
        }, { triggerTurn: true, deliverAs: "followUp" });
        return;
      }
      pi.sendMessage({ customType: "minimal-subagents.notice", content: JSON.stringify(notice), details: { preview }, display: !cards.has(workerTarget(notice)) }, { triggerTurn: true, deliverAs: "followUp" });
    }, (error) => { ctx.ui.notify(`Subagent notification failed: ${String(error)}`, "error"); });
    const runtime = new ParentRuntime(delivery, {
      resolve: (name, overrides) => (dependencies.resolve ?? resolveNamedSpecialist)({
        name, agentDir, cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted(), overrides,
        availableModels: new Set(ctx.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`)),
      }),
      messages: () => ctx.sessionManager.buildSessionProjection().messages,
    });
    const historicalObservations = new Map(saved.filter((entry) => entry.observation !== undefined).map((entry) => [entry.worker.id, entry.observation]));
    const ui = createWorkerUI(ctx, runtime, (id) => driver.observation(id) ?? historicalObservations.get(id), options.widgetRows, appearance, cards);
    current = { parentId, runtime, ui };
    unsubscribeCards = owner.subscribe((event) => cards.refresh(event.type === "state" ? event.worker.id : event.type === "question" ? event.question.workerId : event.workerId));
    cards.refresh();
    dependencies.runtimeChanged?.(runtime);
    return runtime;
  };

  const openWorker: OpenWorker = (target) => {
    if (!current || (target.parentSessionId !== undefined && target.parentSessionId !== current.parentId)) {
      context?.ui.notify("This worker belongs to another parent session.", "warning");
      return;
    }
    void current.ui.open(target.workerId).catch((error: unknown) => context?.ui.notify(`Unable to open worker output: ${String(error)}`, "error"));
  };
  const cards = registerParentTools(pi, getRuntime, () => appearance, openWorker, (target) => {
    if (!current || (target.parentSessionId !== undefined && target.parentSessionId !== current.parentId)) return;
    const worker = current.runtime.delivery.owner.list().find((item) => item.id === target.workerId);
    if (!worker) return;
    const assignment = worker.assignments.find((item) => item.id === worker.currentAssignmentId);
    return { ...workerStatus(worker), ...(assignment ? { prompt: assignment.prompt, report: assignment.report ?? assignment.partialReport ?? "" } : {}) };
  });
  pi.registerMessageRenderer<{ preview?: string }>("minimal-subagents.notice", (message, options, theme) => {
    const target = resultWorkerTarget({ content: typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content });
    const component = renderNotice(message, options.expanded, theme, appearance, openWorker);
    return {
      render: (width) => cards.has(target) ? [] : component.render(width),
      invalidate: () => component.invalidate(),
      handleMouse: (event) => cards.has(target) ? undefined : component.handleMouse?.(event),
    };
  });
  pi.on("context", (event) => {
    let changed = false;
    const messages = event.messages.map((message) => {
      if (message.role !== "custom" || message.customType !== "minimal-subagents.notice"
        || typeof message.details !== "object" || message.details === null
        || !("updateDeliveryId" in message.details) || typeof message.details.updateDeliveryId !== "string") return message;
      const pending = pendingUpdateDeliveries.get(message.details.updateDeliveryId);
      if (!pending) return message;
      pendingUpdateDeliveries.delete(message.details.updateDeliveryId);
      const active = current;
      if (!active || active.parentId !== pending.parentId) return message;
      const worker = active.runtime.delivery.owner.inspect(pending.notice.workerId);
      const assignment = worker.assignments.find((item) => item.id === pending.notice.assignmentId);
      const state = assignment?.outcome ?? pending.notice.state;
      if (state === pending.notice.state) return message;
      changed = true;
      return { ...message, content: JSON.stringify({ ...pending.notice, state }) };
    });
    return changed ? { messages } : undefined;
  });
  pi.registerCommand("subagents", {
    description: "Inspect workers, reports, and transcripts; confirm cancellation",
    async handler(_args, ctx) {
      getRuntime(ctx);
      await current?.ui.open();
    },
  });
  pi.on("session_start", (_event, ctx) => {
    shuttingDown = false;
    context = ctx;
    getRuntime(ctx);
  });
  pi.on("session_before_switch", async (_event, ctx) => {
    if (!current || !hasUnsettledWorkers(current.runtime)) return;
    if (!ctx.hasUI) return { cancel: true };
    const confirmed = await ctx.ui.confirm("Cancel workers and switch sessions?", "Active assignments will be stopped. Cancelled workers cannot continue.");
    if (!confirmed) return { cancel: true };
    // Another switch hook may still decline. Teardown belongs to the actual shutdown event.
  });
  pi.on("session_before_fork", async (_event, ctx) => {
    if (!current || !hasUnsettledWorkers(current.runtime)) return;
    if (!ctx.hasUI) return { cancel: true };
    const confirmed = await ctx.ui.confirm("Cancel workers and fork the session?", "Active assignments will be stopped. The fork will not inherit live workers.");
    if (!confirmed) return { cancel: true };
  });
  pi.on("session_shutdown", async (event, shutdownContext) => {
    shuttingDown = true;
    const previous = current;
    const interrupted = previous?.runtime.delivery.owner.list().filter((worker) =>
      worker.status === "queued" || worker.status === "running" || worker.status === "waiting-question"
      || worker.status === "stopping" || worker.status === "cleanup-unknown" || worker.status === "releasing").length ?? 0;
    let warningFailure: { error: unknown } | undefined;
    if (event.reason === "reload" && interrupted > 0) {
      try {
        shutdownContext.ui.notify(`Reloading Pi will stop ${interrupted} subagent ${interrupted === 1 ? "worker" : "workers"}. Interrupted assignments cannot resume.`, "warning");
      } catch (error) {
        // A notification failure must not prevent teardown or imply child cleanup failed.
        warningFailure = { error };
      }
    }
    try {
      unsubscribeCards();
      cards.clear();
      previous?.ui.dispose();
      await previous?.runtime.shutdown();
    } catch (error) {
      if (previous) {
        health.markUncertain({ parentSessionId: previous.parentId, workerId: "parent-runtime", assignmentId: "shutdown", diagnostic: String(error) });
        health.retain(`owner:${previous.parentId}`, [previous.runtime]);
      }
      throw error;
    } finally {
      current = undefined;
      context = undefined;
      dependencies.runtimeChanged?.(undefined);
    }
    if (warningFailure) throw warningFailure.error;
  });
}
