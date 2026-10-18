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
import type { UpdateAllResult } from "./update-all";
import type { PackageInstallOutputStream } from "./package-install";

const OUTPUT_VIEWPORT_LINES = 20;
const MAX_OUTPUT_CHARACTERS = 250_000;

class UpdateOutputViewport implements Component {
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

export class UpdateOutputModal extends Container {
  private readonly contentBox: Box;
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly done: () => void;
  private readonly titleText: Text;
  private readonly statusText: Text;
  private readonly outputText: Text;
  private readonly helpText: Text;
  private readonly scrollView: ScrollView;
  private readonly outputViewport: UpdateOutputViewport;
  private output = "";
  private running = true;
  private statusMessage: string;
  private statusTone: "accent" | "error" | "success" | "warning" = "accent";

  constructor(tui: TUI, theme: Theme, packageCount: number, done: () => void) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.done = done;
    this.statusMessage = `Updating ${packageCount} package${packageCount === 1 ? "" : "s"}…`;
    this.titleText = new Text();
    this.statusText = new Text();
    this.outputText = new Text("Waiting for package output…", 1, 0);
    this.helpText = new Text();
    this.scrollView = new ScrollView(this.outputText, {
      follow: "end",
      overscroll: "contain",
      primary: true,
      scrollbar: "always",
    });
    this.outputViewport = new UpdateOutputViewport(this.outputText, this.scrollView, () =>
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
  }

  appendOutput(_stream: PackageInstallOutputStream, chunk: string): void {
    const nextOutput = this.output + chunk;
    this.output =
      nextOutput.length > MAX_OUTPUT_CHARACTERS
        ? `[Earlier output omitted]\n${nextOutput.slice(-MAX_OUTPUT_CHARACTERS)}`
        : nextOutput;
    this.outputText.setText(this.output);
    this.scrollView.invalidate();
    this.tui.requestRender();
  }

  finish(result: UpdateAllResult): void {
    this.running = false;
    if (result.cancelled) {
      this.statusMessage = "Update cancelled";
      this.statusTone = "warning";
    } else if (result.failed.length > 0) {
      this.statusMessage =
        result.updated === 0
          ? `Could not update: ${result.failed.join(", ")}`
          : `Updated ${result.updated} of ${result.updated + result.failed.length}; failed: ${result.failed.join(", ")}`;
      this.statusTone = "error";
    } else {
      this.statusMessage = `Updated ${result.updated} package${result.updated === 1 ? "" : "s"}`;
      this.statusTone = "success";
    }
    this.refreshChrome();
    this.tui.requestRender();
  }

  fail(error: unknown): void {
    this.running = false;
    this.statusMessage = "Update failed";
    this.statusTone = "error";
    this.appendOutput(
      "stderr",
      `\n${error instanceof Error ? error.message : String(error)}\n`,
    );
    this.refreshChrome();
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
    this.titleText.setText(this.theme.fg("accent", this.theme.bold("Update all packages")));
    this.statusText.setText(this.theme.fg(this.statusTone, `Status: ${this.statusMessage}`));
    this.helpText.setText(
      this.theme.fg(
        "dim",
        this.running
          ? "Package manager output appears below"
          : "↑↓/PgUp/PgDn/Home/End scroll · Enter/Esc close",
      ),
    );
  }
}
