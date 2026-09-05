import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { paintDockRow } from "./dock-rendering";

export class SubagentTranscriptFrame implements Component {
  constructor(
    private readonly pane: Component & { dispose?(): void },
    private readonly theme: Theme,
  ) {}

  render(width: number): string[] {
    if (width < 2) return [];

    const border = (text: string) =>
      this.theme.bg("selectedBg", this.theme.fg("borderAccent", text));
    const side = border("│");
    const horizontal = "─".repeat(width - 2);
    const background = this.theme.getBgAnsi("selectedBg");
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
