import type { Theme } from "@earendil-works/pi-coding-agent";
import { keyHint } from "@earendil-works/pi-coding-agent";
import {
  Box,
  type Component,
  Container,
  Spacer,
  Text,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { DeltaDetails } from "./shared";
import {
  COLLAPSED_LINES,
  DELTA_ADDED_COLOR,
  DELTA_GUTTER_COLOR,
  DELTA_REMOVED_COLOR,
  ERASE_TO_LINE_END,
  ESCAPE,
  LINE_FILL_MARKER,
  SGR_PATTERN,
  sanitizeTerminalOutput,
  sourceLinesForRender,
} from "./shared";

function sgr(codes: readonly number[]): string {
  return codes.length === 0 ? "" : `${ESCAPE}[${codes.join(";")}m`;
}

/** Preserve Delta's line tints while restoring Pi's tool background after style resets. */
export function applyDiffTheme(
  value: string,
  theme: Pick<Theme, "getBgAnsi" | "getFgAnsi">,
): string {
  const withFillMarkers = value.replaceAll(ERASE_TO_LINE_END, LINE_FILL_MARKER);
  return sanitizeTerminalOutput(withFillMarkers).replace(
    SGR_PATTERN,
    (_sequence, parameters: string) => {
      const codes = parameters === "" ? [0] : parameters.split(";").map(Number);
      const output: string[] = [];
      let pending: number[] = [];
      const flush = () => {
        if (pending.length === 0) return;
        output.push(sgr(pending));
        pending = [];
      };

      for (let index = 0; index < codes.length; ) {
        const code = codes[index] ?? 0;
        if (code === 38 || code === 48) {
          const mode = codes[index + 1];
          const length = mode === 2 ? 5 : mode === 5 ? 3 : 1;
          const group = codes.slice(index, index + length);
          if (code === 38 && mode === 5 && group[2] === DELTA_ADDED_COLOR) {
            flush();
            output.push(theme.getFgAnsi("toolDiffAdded"));
          } else if (code === 38 && mode === 5 && group[2] === DELTA_REMOVED_COLOR) {
            flush();
            output.push(theme.getFgAnsi("toolDiffRemoved"));
          } else {
            pending.push(...group);
          }
          index += length;
          continue;
        }

        if (code === DELTA_GUTTER_COLOR) {
          flush();
          output.push(theme.getFgAnsi("toolDiffContext"));
        } else {
          pending.push(code);
        }
        index += 1;
        if (code === 0) {
          flush();
          output.push(theme.getBgAnsi("toolSuccessBg"));
        }
      }

      flush();
      return output.join("");
    },
  );
}

export function renderDiffLines(lines: readonly string[], width: number): string[] {
  const availableWidth = Math.max(1, width);
  return lines.flatMap((line) => {
    const parts = line.split(LINE_FILL_MARKER);
    let filled = parts.shift() ?? "";
    for (const part of parts) {
      filled += " ".repeat(Math.max(0, availableWidth - visibleWidth(filled))) + part;
    }
    const wrapped = wrapTextWithAnsi(filled, availableWidth);
    return wrapped.length === 0 ? [""] : wrapped;
  });
}

class DiffOutputComponent implements Component {
  constructor(private readonly lines: readonly string[]) {}

  render(width: number): string[] {
    return renderDiffLines(this.lines, width);
  }

  invalidate(): void {}
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
  details: DeltaDetails,
  expanded: boolean,
  theme: Theme,
  loading = false,
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
  const output = [...visible];
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
  details: DeltaDetails,
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

export function renderEditDeltaResult(
  result: { content: Array<{ type: string; text?: string }> },
  details: DeltaDetails,
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
