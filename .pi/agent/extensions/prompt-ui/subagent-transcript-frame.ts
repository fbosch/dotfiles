import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, stripTerminalSequences, truncateToWidth } from "@earendil-works/pi-tui";
import { foregroundToBackground, paintDockRow } from "./dock-rendering";
import { hexForegroundAnsi } from "./terminal-color";

// Use Zenwritten's base color, not the brighter selected-row panel color.
const TRANSCRIPT_BACKGROUND = "#191919";
const ESCAPE = String.fromCharCode(27);
const BELL = String.fromCharCode(7);
const MESSAGE_BOUNDARY_MARKER = new RegExp(`${ESCAPE}]133;[ABC](?:${BELL}|${ESCAPE}\\\\)`, "g");
const NAME_CONTROL_CHARACTERS = /\p{Cc}/gu;

export class SubagentTranscriptFrame implements Component {
  constructor(
    private readonly pane: Component & { dispose?(): void },
    private readonly theme: Theme,
    private readonly agentName: string,
    private readonly agentColor?: string,
  ) {}

  render(width: number): string[] {
    if (width < 2) return [];

    const background = foregroundToBackground(hexForegroundAnsi(this.theme, TRANSCRIPT_BACKGROUND));
    const border = (text: string) =>
      `${background}${this.theme.fg("borderAccent", text)}\u001b[49m`;
    const side = border("│");
    const horizontal = "─".repeat(width - 2);
    const contentWidth = Math.max(0, width - 4);
    // Embedded messages are not terminal prompts. Their OSC 133 markers escape the overlay bounds.
    const content = this.pane
      .render(contentWidth)
      .map((line) => line.replace(MESSAGE_BOUNDARY_MARKER, ""));
    if (content.length > 0) {
      const name = stripTerminalSequences(this.agentName)
        .replace(NAME_CONTROL_CHARACTERS, " ")
        .trim();
      const coloredName =
        this.agentColor === undefined
          ? this.theme.fg("accent", name)
          : `${hexForegroundAnsi(this.theme, this.agentColor)}${name}\u001b[39m`;
      // Replace the pinned pane's fixed header without changing its viewport or footer.
      content[0] = truncateToWidth(
        this.theme.bold(`${coloredName} subagent session`),
        contentWidth,
        "",
      );
    }
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
