import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Container,
  Key,
  matchesKey,
  ScrollView,
  type TUI,
  type TuiMouseEvent,
  type TuiMouseEventResult,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { match, P } from "ts-pattern";
import type { ChildObservation } from "./driver";
import type { ToolRendererLookup } from "./main-window-renderers";
import type { ParentRuntime } from "./parent-runtime";
import { cancellable, terminalText } from "./presentation";
import { type AgentAppearance, agentName, workerTranscript } from "./rendering";

type Choice =
  | { label: string; workerId: string; action?: never }
  | { label: string; action: "cancel-all"; workerId?: never };
type Action = "Follow latest" | "Cancel worker…" | "Back to list" | "Hide details" | "Show details";
interface TranscriptView {
  content: Container;
  scroll: ScrollView;
}

/** Read-only inspection. All mutations pass through the same parent control interface. */
export class SubagentOverlay implements Component {
  private selected = 0;
  private inspected: string | undefined;
  private readonly metadataExpanded = new Set<string>();
  private actionIndex = -1;
  private readonly views = new Map<string, TranscriptView>();
  private readonly unsubscribe: () => void;
  private busy = false;
  private error = "";
  private disposed = false;

  constructor(
    private readonly runtime: ParentRuntime,
    private readonly options: {
      observation: (id: string) => ChildObservation | undefined;
      height: () => number;
      theme: Theme;
      tui?: TUI;
      cwd?: string;
      getToolRenderers?: ToolRendererLookup;
      appearance?: AgentAppearance;
      requestRender: () => void;
      close: () => void;
      confirm: (title: string, message: string) => Promise<boolean>;
    },
  ) {
    this.unsubscribe = runtime.delivery.owner.subscribe(() => this.refresh());
  }

  refresh(): void {
    if (!this.disposed) this.options.requestRender();
  }

  inspect(workerId: string): void {
    this.runtime.delivery.owner.inspect(workerId);
    this.selected = this.choices().findIndex((choice) => choice.workerId === workerId);
    this.inspected = workerId;
    this.actionIndex = -1;
    this.refresh();
  }
  invalidate(): void {
    for (const view of this.views.values()) view.content.invalidate();
  }
  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
  }

  private choices(): Choice[] {
    const workers = this.runtime.delivery.owner.list();
    const choices: Choice[] = workers.map((worker) => ({
      workerId: worker.id,
      label: `${terminalText(worker.specialist)} · ${worker.status} · ${terminalText(worker.id)}`,
    }));
    if (workers.some(cancellable))
      choices.push({ label: "Cancel all active workers…", action: "cancel-all" });
    return choices;
  }

  private view(id: string): TranscriptView {
    let view = this.views.get(id);
    if (!view) {
      const content = new Container();
      view = { content, scroll: new ScrollView(content, { follow: "end", scrollbar: "hidden" }) };
      this.views.set(id, view);
    }
    return view;
  }

  private actions(): Action[] {
    if (!this.inspected) return [];
    const worker = this.runtime.delivery.owner.inspect(this.inspected);
    return [
      "Follow latest",
      ...(cancellable(worker) ? ["Cancel worker…" as const] : []),
      "Back to list",
      this.metadataExpanded.has(worker.id) ? "Hide details" : "Show details",
    ];
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (this.busy || this.disposed || event.type !== "wheel") return;
    const delta = event.wheelDelta ?? 0;
    if (!Number.isFinite(delta) || delta === 0) return;
    if (this.inspected) {
      this.view(this.inspected).scroll.scrollBy(delta);
    } else {
      this.selected = Math.max(
        0,
        Math.min(this.choices().length - 1, this.selected + Math.trunc(delta)),
      );
    }
    this.refresh();
    // Consume wheel input at either end instead of scrolling the parent transcript.
    return { handled: true, render: true };
  }

  handleInput(data: string): void {
    if (this.busy || this.disposed) return;
    if (matchesKey(data, Key.escape)) {
      this.options.close();
      return;
    }
    if (this.inspected) {
      const view = this.view(this.inspected);
      const actions = this.actions();
      if (matchesKey(data, Key.tab))
        this.actionIndex = ((this.actionIndex + 2) % (actions.length + 1)) - 1;
      else if (matchesKey(data, Key.enter) && this.actionIndex >= 0) {
        const inspected = this.inspected;
        match(actions[this.actionIndex])
          .with("Follow latest", () => {
            view.scroll.scrollToEnd();
            this.actionIndex = -1;
          })
          .with("Back to list", () => {
            this.inspected = undefined;
            this.actionIndex = -1;
          })
          .with("Show details", "Hide details", () => {
            if (this.metadataExpanded.has(inspected)) this.metadataExpanded.delete(inspected);
            else this.metadataExpanded.add(inspected);
            view.scroll.scrollToStart();
          })
          .with("Cancel worker…", () => this.cancel([inspected]))
          .with(undefined, () => undefined)
          .exhaustive();
      } else if (matchesKey(data, Key.up)) view.scroll.scrollBy(-1);
      else if (matchesKey(data, Key.down)) view.scroll.scrollBy(1);
      else if (matchesKey(data, Key.pageUp))
        view.scroll.scrollBy(-Math.max(1, view.scroll.viewportHeight - 1));
      else if (matchesKey(data, Key.pageDown))
        view.scroll.scrollBy(Math.max(1, view.scroll.viewportHeight - 1));
      else if (matchesKey(data, Key.home)) view.scroll.scrollToStart();
      else if (matchesKey(data, Key.end)) view.scroll.scrollToEnd();
    } else {
      const choices = this.choices();
      if (matchesKey(data, Key.up)) this.selected = Math.max(0, this.selected - 1);
      else if (matchesKey(data, Key.down))
        this.selected = Math.min(choices.length - 1, this.selected + 1);
      else if (matchesKey(data, Key.enter)) {
        match(choices[this.selected])
          .with({ action: "cancel-all" }, () =>
            this.cancel(
              this.runtime.delivery.owner
                .list()
                .filter(cancellable)
                .map((worker) => worker.id),
            ),
          )
          .with({ workerId: P.string }, ({ workerId }) => {
            if (!workerId) return;
            this.inspected = workerId;
            this.actionIndex = -1;
          })
          .with(undefined, () => undefined)
          .exhaustive();
      }
    }
    this.refresh();
  }

  private cancel(ids: string[]): void {
    this.busy = true;
    this.error = "";
    const run = async () => {
      const confirmed = await this.options.confirm(
        ids.length === 1 ? "Cancel this worker?" : `Cancel ${ids.length} workers?`,
        "Cancelled workers cannot continue.",
      );
      if (!confirmed || this.disposed) return;
      const results = await Promise.allSettled(
        ids.map((workerId) => {
          if (!cancellable(this.runtime.delivery.owner.inspect(workerId))) return Promise.resolve();
          return this.runtime.control({ action: "cancel", workerId });
        }),
      );
      const errors = results.flatMap((result) =>
        match(result)
          .with({ status: "rejected" }, ({ reason }) => [String(reason)])
          .with({ status: "fulfilled" }, () => [])
          .exhaustive(),
      );
      if (errors.length) this.error = errors.join("; ");
    };
    void run()
      .catch((error: unknown) => {
        this.error = String(error);
      })
      .finally(() => {
        this.busy = false;
        this.refresh();
      });
  }

  render(width: number): string[] {
    const height = Math.max(5, Math.floor(this.options.height()));
    const bodyHeight = height - 3;
    let body: string[];
    let footer: string;
    if (this.inspected) {
      const worker = this.runtime.delivery.owner.inspect(this.inspected);
      const view = this.view(this.inspected);
      view.content.clear();
      view.content.addChild(
        workerTranscript(
          worker,
          this.options.observation(worker.id),
          this.options.theme,
          this.options.tui && this.options.cwd !== undefined
            ? {
                tui: this.options.tui,
                cwd: this.options.cwd,
                getToolRenderers: this.options.getToolRenderers,
              }
            : undefined,
          this.metadataExpanded.has(worker.id),
        ),
      );
      const lines = view.content.render(width);
      view.scroll.updateLayout(lines.length, bodyHeight, this.options.requestRender);
      body = lines.slice(view.scroll.scrollTop, view.scroll.scrollTop + bodyHeight);
      const actions = this.actions();
      this.actionIndex = Math.min(this.actionIndex, actions.length - 1);
      footer = actions
        .map((action, index) => (index === this.actionIndex ? `[${action}]` : action))
        .join(" | ");
    } else {
      const choices = this.choices();
      this.selected = Math.max(0, Math.min(this.selected, choices.length - 1));
      const offset = Math.max(0, this.selected - bodyHeight + 1);
      body = choices
        .slice(offset, offset + bodyHeight)
        .map((choice, index) => `${index + offset === this.selected ? ">" : " "} ${choice.label}`);
      if (!body.length) body = ["No workers in this parent session"];
      footer = "↑↓ Select · Enter Inspect or act · Esc Close";
    }
    while (body.length < bodyHeight) body.push("");
    const theme = this.options.theme;
    const selectedWorker = this.inspected
      ? this.runtime.delivery.owner.inspect(this.inspected)
      : undefined;
    const title = selectedWorker
      ? `Subagents · ${agentName(selectedWorker.specialist, theme, this.options.appearance)}`
      : "Subagents";
    const hint = terminalText(
      this.error ||
        (this.busy
          ? "Waiting for cancellation confirmation or shutdown"
          : this.inspected
            ? "↑↓ Scroll · Tab Actions · Enter Choose · Esc Close"
            : ""),
    );
    return [
      title,
      ...body,
      theme.fg(this.error ? "error" : "dim", hint),
      theme.fg("dim", footer),
    ].map((line) => truncateToWidth(line, Math.max(1, width), ""));
  }
}
