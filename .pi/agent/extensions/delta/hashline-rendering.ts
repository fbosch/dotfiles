import { stripVTControlCharacters } from "node:util";
import { getLanguageFromPath, highlightCode } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { registerHashlineReadRendering } from "./read-rendering";
import { diffComponent } from "./rendering";
import {
  HASHLINE_DIFF_ROW_PATTERN,
  HASHLINE_DIFF_TOOLS,
  HASHLINE_GREP_ROW_PATTERN,
  isDeltaDetails,
} from "./shared";

type RendererAPI = Parameters<typeof registerHashlineReadRendering>[0];
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function source(text: string, path: unknown): string {
  return highlightCode(text, typeof path === "string" ? getLanguageFromPath(path) : undefined).join("\n");
}

/** Resolve at display time: hashline may re-register tools, and saved results lack Delta snapshots. */
export function registerHashlineRendering(pi: RendererAPI): void {
  registerHashlineReadRendering(pi);
  pi.registerToolRenderer((name, next) => {
    const original = next();
    if ((!HASHLINE_DIFF_TOOLS.has(name) && name !== "grep") || !original?.renderResult) return original;
    const fallback = original.renderResult;
    return {
      ...original,
      renderResult(result, options, theme, context) {
        const unchanged = () => fallback(result, options, theme, context);
        if (context.isError || options.isPartial || context.isPartial || result.content.some((block) => block.type !== "text")) return unchanged();
        const details = record(result.details);
        const text = result.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
        if (name !== "grep" && isDeltaDetails(details.delta)) {
          const component = new Container();
          component.addChild(diffComponent(details.delta, options.expanded || context.expanded, theme));
          const notices = editNotices(details, text);
          if (notices) component.addChild(new Text(notices, 0, 0));
          return component;
        }
        const raw = name === "grep" ? text : details.diff;
        if (typeof raw !== "string") return unchanged();
        const lines = stripVTControlCharacters(raw).split("\n");
        let path: unknown = record(context.args).path;
        let found = false;
        let lastSource = -1;
        const numbers = Array.isArray(details.diffLineNumbers) ? details.diffLineNumbers : [];
        const output = lines.map((line, index) => {
          const heading = name === "grep" ? /^=== (.+) ===$/u.exec(line) : /^--- (.+) ---$/u.exec(line);
          if (heading) { path = heading[1]; return theme.fg("accent", line); }
          const row = (name === "grep" ? HASHLINE_GREP_ROW_PATTERN : HASHLINE_DIFF_ROW_PATTERN).exec(line);
          if (!row) return theme.fg("dim", line);
          found = true;
          lastSource = index;
          const number = numbers[index];
          const gutter = name === "grep" ? `${row[1]} ` : `${typeof number === "number" ? `${number} │ ` : ""}${row[1]} `;
          const color = name === "grep" ? "dim" : row[1] === "+" ? "toolDiffAdded" : row[1] === "-" ? "toolDiffRemoved" : "toolDiffContext";
          return theme.fg(color, gutter) + source(row[2]!, path);
        });
        if (!found) return unchanged();
        const component = new Container();
        component.addChild(diffComponent({ display: "inline", noChanges: false, output: output.slice(0, lastSource + 1).join("\n"), scope: name, width: 120 },
          options.expanded || context.expanded, theme));
        // Metadata stays visible even when the source preview is collapsed; never mutate saved evidence.
        const tail = lines.slice(lastSource + 1).join("\n");
        if (tail.trim()) component.addChild(new Text(tail, 0, 0));
        if (name !== "grep") {
          const notices = editNotices(details, text);
          if (notices) component.addChild(new Text(notices, 0, 0));
        }
        return component;
      },
    };
  });
}

function editNotices(details: Record<string, unknown>, text: string): string {
  const notices: string[] = [];
  for (const [key, label] of [["warnings", "Warnings"], ["hints", "Hints"]] as const) {
    const values = details[key];
    if (Array.isArray(values) && values.every((value) => typeof value === "string") && values.length) {
      notices.push(`${label}:\n${values.join("\n")}`);
    } else {
      const section = text.match(new RegExp(`(?:^|\\n)${label}:\\n[\\s\\S]*?(?=\\n\\n(?:Warnings|Hints):\\n|$)`))?.[0]?.trim();
      if (section) notices.push(section);
    }
  }
  return stripVTControlCharacters(notices.join("\n\n"));
}
