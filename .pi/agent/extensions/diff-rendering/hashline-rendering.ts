import { stripVTControlCharacters } from "node:util";
import { getLanguageFromPath, highlightCode } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { diffAnnotation, diffCell, diffRule } from "./presentation";
import { registerHashlineReadRendering } from "./read-rendering";
import { diffComponent } from "./rendering";
import {
  effectiveWidth,
  HASHLINE_DIFF_ROW_PATTERN,
  HASHLINE_DIFF_TOOLS,
  HASHLINE_GREP_ROW_PATTERN,
  isDiffDetails,
} from "./shared";

const isEllipsis = (line: string) => /^\s*(?:\.{3}|…|·{3})\s*$/u.test(line);

type RendererAPI = Parameters<typeof registerHashlineReadRendering>[0];
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function source(text: string, path: unknown): string {
  return highlightCode(text, typeof path === "string" ? getLanguageFromPath(path) : undefined).join(
    "\n",
  );
}

/** Resolve at display time: hashline may re-register tools, and saved results lack Diff snapshots. */
export function registerHashlineRendering(pi: RendererAPI): void {
  registerHashlineReadRendering(pi);
  pi.registerToolRenderer((name, next) => {
    const original = next();
    if ((!HASHLINE_DIFF_TOOLS.has(name) && name !== "grep") || !original?.renderResult)
      return original;
    const fallback = original.renderResult;
    return {
      ...original,
      renderResult(result, options, theme, context) {
        const unchanged = () => fallback(result, options, theme, context);
        if (
          context.isError ||
          options.isPartial ||
          context.isPartial ||
          result.content.some((block) => block.type !== "text")
        )
          return unchanged();
        const details = record(result.details);
        const text = result.content
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join("\n");
        if (name !== "grep" && isDiffDetails(details.diffRendering)) {
          const component = new Container();
          component.addChild(
            diffComponent(details.diffRendering, options.expanded || context.expanded, theme),
          );
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
        const width = effectiveWidth(process.stdout.columns);
        const numberWidth = Math.max(
          2,
          ...numbers.map((number) => (typeof number === "number" ? String(number).length : 0)),
        );
        const output = lines.map((line, index) => {
          const heading =
            name === "grep" ? /^=== (.+) ===$/u.exec(line) : /^--- (.+) ---$/u.exec(line);
          if (heading) {
            path = heading[1];
            return theme.fg("accent", line);
          }
          const row = (
            name === "grep" ? HASHLINE_GREP_ROW_PATTERN : HASHLINE_DIFF_ROW_PATTERN
          ).exec(line);
          if (!row)
            return name !== "grep" && isEllipsis(line)
              ? diffAnnotation(line, width)
              : theme.fg("dim", line);
          found = true;
          lastSource = index;
          const number = numbers[index];
          if (name === "grep") return theme.fg("dim", `${row[1]} `) + source(row[2] ?? "", path);
          const kind = row[1] === "+" ? "+" : row[1] === "-" ? "-" : " ";
          return diffCell(
            source(row[2] ?? "", path),
            kind,
            typeof number === "number" ? number : undefined,
            width,
            numberWidth,
          ).join("\n");
        });
        if (!found) return unchanged();
        const tail = lines.slice(lastSource + 1);
        const trailingPreview =
          name === "grep"
            ? ""
            : tail
                .filter(isEllipsis)
                .map((line) => diffAnnotation(line, width))
                .join("\n");
        const component = new Container();
        component.addChild(
          diffComponent(
            {
              display: "inline",
              noChanges: false,
              output: (name === "grep"
                ? output.slice(0, lastSource + 1)
                : [diffRule(width), ...output.slice(0, lastSource + 1), diffRule(width)]
              ).join("\n"),
              scope: name,
              width,
            },
            options.expanded || context.expanded,
            theme,
            false,
            trailingPreview,
          ),
        );
        // Metadata stays visible even when the source preview is collapsed; never mutate saved evidence.
        const metadata = tail.filter((line) => name === "grep" || !isEllipsis(line)).join("\n");
        if (metadata.trim()) component.addChild(new Text(metadata, 0, 0));
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
  for (const [key, label] of [
    ["warnings", "Warnings"],
    ["hints", "Hints"],
  ] as const) {
    const values = details[key];
    if (
      Array.isArray(values) &&
      values.every((value) => typeof value === "string") &&
      values.length
    ) {
      notices.push(`${label}:\n${values.join("\n")}`);
    } else {
      const section = text
        .match(new RegExp(`(?:^|\\n)${label}:\\n[\\s\\S]*?(?=\\n\\n(?:Warnings|Hints):\\n|$)`))?.[0]
        ?.trim();
      if (section) notices.push(section);
    }
  }
  return stripVTControlCharacters(notices.join("\n\n"));
}
