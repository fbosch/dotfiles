import { DynamicBorder, type Theme } from "@earendil-works/pi-coding-agent";
import {
  Box,
  type Component,
  Container,
  matchesKey,
  ScrollView,
  Text,
  type TUI,
} from "@earendil-works/pi-tui";

export interface RecipeOutput {
  text: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface RecipeOutputStatus {
  code: number;
  killed: boolean;
  timedOut: boolean;
}

export type RecipeOutputHandler = (output: RecipeOutput) => void;

type StatusTone = "accent" | "error" | "success" | "warning";
// Overlay components skip the normal layout pass, so clipping and scroll state are handled here.
const OUTPUT_VIEWPORT_LINES = 20;

class OutputViewport implements Component {
  constructor(
    private readonly outputText: Text,
    private readonly scrollView: ScrollView,
    private readonly requestRender: () => void,
  ) {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, Math.floor(width));
    const hasScrollbar = safeWidth > 1 && this.scrollView.scrollbar === "always";
    const contentWidth = this.scrollView.getContentWidth(safeWidth);
    const contentLines = this.outputText.render(contentWidth);
    this.scrollView.updateLayout(contentLines.length, OUTPUT_VIEWPORT_LINES, this.requestRender);

    const visibleLines = contentLines.slice(
      this.scrollView.scrollTop,
      this.scrollView.scrollTop + OUTPUT_VIEWPORT_LINES,
    );
    while (visibleLines.length < OUTPUT_VIEWPORT_LINES) {
      visibleLines.push(" ".repeat(contentWidth));
    }
    if (!hasScrollbar) return visibleLines;

    const maxScrollTop = Math.max(0, contentLines.length - OUTPUT_VIEWPORT_LINES);
    const thumbHeight = Math.max(
      Math.min(2, OUTPUT_VIEWPORT_LINES),
      Math.min(
        OUTPUT_VIEWPORT_LINES,
        Math.round(
          (OUTPUT_VIEWPORT_LINES * OUTPUT_VIEWPORT_LINES) / Math.max(1, contentLines.length),
        ),
      ),
    );
    const maxThumbTop = OUTPUT_VIEWPORT_LINES - thumbHeight;
    const thumbTop =
      maxScrollTop === 0 ? 0 : Math.round((this.scrollView.scrollTop / maxScrollTop) * maxThumbTop);

    return visibleLines.map((line, index) => {
      const scrollbar =
        index >= thumbTop && index < thumbTop + thumbHeight
          ? this.scrollView.scrollbarThumbStyle("┃")
          : this.scrollView.scrollbarTrackStyle("│");
      return `${line}${scrollbar}`;
    });
  }

  invalidate(): void {
    this.scrollView.invalidate();
  }
}

export class JustOutputModal extends Container {
  private readonly contentBox: Box;
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly done: () => void;
  private readonly titleText: Text;
  private readonly statusText: Text;
  private readonly outputText: Text;
  private readonly helpText: Text;
  private readonly scrollView: ScrollView;
  private readonly title: string;
  private readonly outputViewport: OutputViewport;
  private running = true;
  private statusMessage = "Running…";
  private statusTone: StatusTone = "accent";

  constructor(
    tui: TUI,
    theme: Theme,
    recipeName: string,
    arguments_: string[],
    signal: AbortSignal,
    done: () => void,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.done = done;
    this.title = `just ${recipeName}${arguments_.length > 0 ? ` ${JSON.stringify(arguments_)}` : ""}`;
    this.titleText = new Text();
    this.statusText = new Text();
    this.outputText = new Text("Waiting for output…", 1, 0);
    this.helpText = new Text();
    this.scrollView = new ScrollView(this.outputText, {
      follow: "end",
      overscroll: "contain",
      primary: true,
      scrollbar: "always",
    });
    this.outputViewport = new OutputViewport(this.outputText, this.scrollView, () =>
      tui.requestRender(),
    );

    this.contentBox = new Box(1, 1, (line) => theme.bg("toolPendingBg", line));
    this.contentBox.addChild(new DynamicBorder((line) => theme.fg("accent", line)));
    this.contentBox.addChild(this.titleText);
    this.contentBox.addChild(this.statusText);
    this.contentBox.addChild(this.outputViewport);
    this.contentBox.addChild(this.helpText);
    this.contentBox.addChild(new DynamicBorder((line) => theme.fg("accent", line)));
    this.addChild(this.contentBox);
    this.refreshChrome();

    signal.addEventListener(
      "abort",
      () => {
        if (this.running === false) return;
        this.statusMessage = "Cancelling…";
        this.statusTone = "warning";
        this.refreshChrome();
        this.tui.requestRender();
      },
      { once: true },
    );
  }

  updateOutput(output: RecipeOutput): void {
    this.outputText.setText(output.text);
    this.scrollView.invalidate();
    this.tui.requestRender();
  }

  finish(result: RecipeOutputStatus, output: RecipeOutput, cancelled: boolean): void {
    this.running = false;
    this.updateOutput(output);
    if (cancelled || (result.killed && result.timedOut === false)) {
      this.statusMessage = "Cancelled";
      this.statusTone = "warning";
    } else if (result.timedOut) {
      this.statusMessage = "Timed out";
      this.statusTone = "error";
    } else if (result.code === 0 && result.killed === false) {
      this.statusMessage = "Completed";
      this.statusTone = "success";
    } else {
      this.statusMessage = `Failed (exit code ${result.code})`;
      this.statusTone = "error";
    }
    this.refreshChrome();
    this.tui.requestRender();
  }

  fail(error: unknown): void {
    this.running = false;
    this.statusMessage = "Failed";
    this.statusTone = "error";
    this.outputText.setText(error instanceof Error ? error.message : String(error));
    this.scrollView.invalidate();
    this.refreshChrome();
    this.tui.requestRender();
  }

  handleInput(data: string): void {
    if (this.running) return;
    if (matchesKey(data, "escape") || matchesKey(data, "enter") || matchesKey(data, "ctrl+c")) {
      this.done();
      return;
    }

    const scrollDelta = matchesKey(data, "up")
      ? -1
      : matchesKey(data, "down")
        ? 1
        : matchesKey(data, "pageUp")
          ? -Math.max(1, this.scrollView.viewportHeight - 1)
          : matchesKey(data, "pageDown")
            ? Math.max(1, this.scrollView.viewportHeight - 1)
            : 0;
    if (scrollDelta !== 0) {
      this.scrollView.scrollBy(scrollDelta);
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, "home")) {
      this.scrollView.scrollToStart();
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, "end")) {
      this.scrollView.scrollToEnd();
      this.tui.requestRender();
    }
  }

  override invalidate(): void {
    super.invalidate();
    this.refreshChrome();
  }

  private refreshChrome(): void {
    this.titleText.setText(this.theme.fg("accent", this.theme.bold(this.title)));
    this.statusText.setText(this.theme.fg(this.statusTone, `Status: ${this.statusMessage}`));
    this.helpText.setText(
      this.theme.fg(
        "dim",
        this.running ? "Esc/Ctrl+C cancel" : "↑↓/PgUp/PgDn/Home/End scroll • Enter/Esc close",
      ),
    );
  }
}
