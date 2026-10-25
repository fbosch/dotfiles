import type { Theme } from "@earendil-works/pi-coding-agent";
import { keyHint } from "@earendil-works/pi-coding-agent";
import {
  Box,
  type Component,
  Container,
  Spacer,
  Text,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { DiffDetails } from "./shared";
import { COLLAPSED_LINES, ESCAPE, sanitizeTerminalOutput, sourceLinesForRender } from "./shared";

/** Restore the tool background after generated syntax style resets. */
export function applyDiffTheme(value: string, theme: Pick<Theme, "getBgAnsi">): string {
  return sanitizeTerminalOutput(value).replace(
    new RegExp(`${ESCAPE}\\[(?:0)?m`, "gu"),
    (sequence) => sequence + theme.getBgAnsi("toolSuccessBg"),
  );
}

export function renderDiffLines(lines: readonly string[], width: number): string[] {
  return lines.flatMap((line) => {
    const wrapped = wrapTextWithAnsi(line, Math.max(1, width));
    return wrapped.length ? wrapped : [""];
  });
}

class DiffOutputComponent implements Component {
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(private readonly lines: readonly string[]) {}

  render(width: number): string[] {
    if (this.cachedLines === undefined || this.cachedWidth !== width) {
      this.cachedLines = renderDiffLines(this.lines, width);
      this.cachedWidth = width;
    }
    return this.cachedLines;
  }

  invalidate(): void {
    this.cachedLines = undefined;
    this.cachedWidth = undefined;
  }
}

function statusLine(theme: Theme, label: "Info" | "Warning", message: string): string {
  const color = label === "Warning" ? "warning" : "accent";
  return `${theme.fg(color, theme.bold(label.padEnd(7)))}  ${message}`;
}

function detailLines(value: string): string[] {
  const lines = value.split("\n");
  const first = lines[0] ?? "";
  return [first, ...lines.slice(1).map((line) => `  ${line}`)];
}

export function diffComponent(
  details: DiffDetails,
  expanded: boolean,
  theme: Theme,
  loading = false,
  trailingPreview = "",
): Component {
  const lines = sourceLinesForRender(applyDiffTheme(details.output, theme));
  if (details.noChanges) {
    const output: string[] = [];
    if (details.warning !== undefined) {
      output.push(...detailLines(statusLine(theme, "Warning", details.warning)));
    }
    return new DiffOutputComponent(output);
  }

  const visible = expanded ? lines : lines.slice(0, COLLAPSED_LINES);
  const output = [
    ...visible,
    ...(trailingPreview ? sourceLinesForRender(applyDiffTheme(trailingPreview, theme)) : []),
  ];
  if (!expanded && visible.length < lines.length) {
    output.push(
      "",
      statusLine(
        theme,
        "Info",
        `${lines.length - visible.length} more lines (${keyHint("app.tools.expand", "to expand")}).`,
      ),
    );
  }
  if (loading) {
    output.push("", statusLine(theme, "Info", "Rendering full diff..."));
  }
  if (details.truncation !== undefined) {
    output.push("", statusLine(theme, "Warning", "Diff output was truncated."));
    if (details.fullOutputPath !== undefined) {
      output.push(`  Full output  ${details.fullOutputPath}`);
    }
  }
  if (details.warning !== undefined) {
    output.push("", ...detailLines(statusLine(theme, "Warning", details.warning)));
  }
  return new DiffOutputComponent(output);
}

export function replaceEditPreview(
  component: Component,
  details: DiffDetails,
  expanded: boolean,
  theme: Theme,
  loading = false,
): Component {
  if (!(component instanceof Box)) return component;
  const header = component.children[0];
  component.clear();
  if (header !== undefined) component.addChild(header);
  component.addChild(new Spacer(1));
  component.addChild(diffComponent(details, expanded, theme, loading));
  component.setBgFn((text) => theme.bg("toolSuccessBg", text));
  return component;
}

export function renderEditDiffResult(
  result: { content: Array<{ type: string; text?: string }> },
  details: DiffDetails,
  expanded: boolean,
  theme: Theme,
): Component {
  const component = new Container();
  const summary = result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n");
  if (summary !== "") {
    component.addChild(new Spacer(1));
    component.addChild(new Text(theme.fg("success", summary), 1, 0));
  }
  component.addChild(new Spacer(1));
  component.addChild(diffComponent(details, expanded, theme));
  return component;
}
