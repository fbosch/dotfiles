import { stripVTControlCharacters } from "node:util";
import {
  getLanguageFromPath,
  highlightCode,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import type { TSchema } from "typebox";
import { diffComponent } from "./rendering";
import { HASHLINE_READ_ROW_PATTERN } from "./shared";

type Renderers = Pick<
  ToolDefinition<TSchema, unknown, unknown>,
  "renderShell" | "renderCall" | "renderResult"
>;
type Resolver = (name: string, next: () => Renderers | undefined) => Renderers | undefined;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Renderer-only registration preserves hashline execution, anchors, and persisted
// results. The subagent bridge resolves this same chain from the main window.
export function registerHashlineReadRendering(pi: {
  registerToolRenderer(resolver: Resolver): void;
}): void {
  pi.registerToolRenderer((name, next) => {
    const original = next();
    if (name !== "read" || !original?.renderResult) return original;
    const fallback = original.renderResult;
    return {
      ...original,
      renderResult(result, options, theme, context) {
        const unchanged = () => fallback(result, options, theme, context);
        if (context.isError || options.isPartial || context.isPartial) return unchanged();
        const block = result.content.length === 1 ? result.content[0] : undefined;
        if (block?.type !== "text") return unchanged();
        const lines = stripVTControlCharacters(block.text).split("\n");
        const source: string[] = [];
        for (const line of lines) {
          const content = HASHLINE_READ_ROW_PATTERN.exec(line)?.[1];
          if (content === undefined) break;
          source.push(content);
        }
        if (!source.length) return unchanged();
        const args = record(context.args);
        const details = record(result.details);
        const offset = details.offset ?? args.offset ?? 1;
        if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 1)
          return unchanged();
        const language = typeof args.path === "string" ? getLanguageFromPath(args.path) : undefined;
        const highlighted = highlightCode(source.join("\n"), language);
        const gutterWidth = String(offset + source.length - 1).length;
        const output = source.map(
          (_line, index) =>
            theme.fg("dim", String(offset + index).padStart(gutterWidth) + " │ ") +
            (highlighted[index] ?? ""),
        );
        // Pagination and warnings are metadata, not source code.
        const component = new Container();
        component.addChild(
          diffComponent(
            {
              display: "inline",
              noChanges: false,
              output: output.join("\n"),
              scope: "read",
              width: 120,
            },
            options.expanded || context.expanded,
            theme,
          ),
        );
        if (lines.length > source.length)
          component.addChild(new Text(lines.slice(source.length).join("\n"), 0, 0));
        return component;
      },
    };
  });
}
