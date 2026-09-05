import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { foregroundToBackground, paintDockRow } from "./dock-rendering";
import { hexForegroundAnsi } from "./terminal-color";

// Use Zenwritten's base color, not the brighter selected-row panel color.
const TRANSCRIPT_BACKGROUND = "#191919";

export class SubagentTranscriptFrame implements Component {
  constructor(
    private readonly pane: Component & { dispose?(): void },
    private readonly theme: Theme,
  ) {}

  render(width: number): string[] {
    if (width < 2) return [];

    const background = foregroundToBackground(hexForegroundAnsi(this.theme, TRANSCRIPT_BACKGROUND));
    const border = (text: string) =>
      `${background}${this.theme.fg("borderAccent", text)}\u001b[49m`;
    const side = border("│");
    const horizontal = "─".repeat(width - 2);
    const content = this.pane.render(Math.max(0, width - 4));
    return [
      border(`╭${horizontal}╮`),
      ...content.map((line) => paintDockRow(` ${line}`, width, side, background, side)),
      border(`╰${horizontal}╯`),
    ];
  }

  handleInput(data: string): void {
    this.pane.handleInput?.(data);
  }

  invalidate(): void {
    this.pane.invalidate();
  }

  dispose(): void {
    this.pane.dispose?.();
  }
}
