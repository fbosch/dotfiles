import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { TSchema } from "typebox";

type ToolRenderers = Pick<
  ToolDefinition<TSchema, unknown, unknown>,
  "renderShell" | "renderCall" | "renderResult"
>;
type ToolRendererResolver = (
  toolName: string,
  next: () => ToolRenderers | undefined,
) => ToolRenderers | undefined;

// Pi 1.0.4 exposes this hook; remove the local signature when the 0.99.1 SDK is updated.
export default function subagentSteeringNotice(pi: {
  registerToolRenderer(resolver: ToolRendererResolver): void;
}): void {
  pi.registerToolRenderer((toolName, next) => {
    const original = next();
    if (toolName !== "steer_subagent") return original;

    return {
      ...original,
      renderResult(result, options, theme, context) {
        const content = result.content;
        const block = content.length === 1 ? content[0] : undefined;
        if (!options.expanded && !options.isPartial && !context.isPartial && !context.isError) {
          // The upstream tool has no structured outcome. Match its complete success messages so
          // errors, extra warnings, and changed output remain visible rather than claiming success.
          const text = block?.type === "text" ? block.text : "";
          const sent = text.match(
            /^Steering message sent to agent (\S+)\. The agent will process it after its current tool execution\.\nCurrent state: [^\r\n]+$/,
          );
          const queued = text.match(
            /^Steering message queued for agent (\S+)\. It will be delivered once the session initializes\.$/,
          );
          if (sent || queued) {
            const status = sent ? "sent" : "queued";
            const id = sent?.[1] ?? queued?.[1];
            return new Text(theme.fg("dim", `Subagent steering ${status} · ${id}`), 0, 0);
          }
        }

        if (original?.renderResult) return original.renderResult(result, options, theme, context);
        return new Text(
          content
            .filter((item) => item.type === "text")
            .map((item) => theme.fg("toolOutput", item.text))
            .join("\n"),
          0,
          0,
        );
      },
    };
  });
}
