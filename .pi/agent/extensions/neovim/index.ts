import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { match } from "ts-pattern";
import { type Static, Type } from "typebox";
import { type NvimConnectionFactory, PiNeovimChannel } from "./channel";
import type { BridgeResult, NeovimErrorCode } from "./contracts";

const NeovimParameters = Type.Union([
  Type.Object({ operation: Type.Literal("status") }, { additionalProperties: false }),
  Type.Object({ operation: Type.Literal("context") }, { additionalProperties: false }),
  Type.Object({ operation: Type.Literal("focus_context") }, { additionalProperties: false }),
  Type.Object({ operation: Type.Literal("selection") }, { additionalProperties: false }),
]);

type NeovimInput = Static<typeof NeovimParameters>;

interface NeovimToolDetails {
  readonly code?: NeovimErrorCode;
  readonly ok: boolean;
  readonly operation: NeovimInput["operation"];
}

interface NeovimExtensionDependencies {
  readonly createConnection?: NvimConnectionFactory;
  readonly socketPath?: string;
}

function resultText(result: BridgeResult<unknown>): string {
  if (result.ok === false) return `${result.error.code}: ${result.error.message}`;
  return JSON.stringify(result.value, null, 2);
}

function resultDetails(
  operation: NeovimInput["operation"],
  result: BridgeResult<unknown>,
): NeovimToolDetails {
  return result.ok ? { ok: true, operation } : { code: result.error.code, ok: false, operation };
}

export function createNeovimExtension(dependencies: NeovimExtensionDependencies = {}) {
  const inheritedSocket = dependencies.socketPath ?? process.env.PI_NVIM_SOCKET;

  return function neovimExtension(pi: ExtensionAPI): void {
    let channel: PiNeovimChannel | undefined;

    const channelFor = (context: ExtensionContext): PiNeovimChannel => {
      channel ??= new PiNeovimChannel(inheritedSocket, context.cwd, dependencies.createConnection);
      return channel;
    };

    pi.registerTool(
      defineTool<typeof NeovimParameters, NeovimToolDetails>({
        name: "neovim",
        label: "Neovim",
        description:
          "Inspect the exact Neovim instance that launched this Pi session. Operations report connection status, current editor context, the last focused source context, or the bounded source selection. The socket is fixed by the launch environment and cannot be selected by tool input.",
        promptSnippet: "Inspect live context from the Neovim instance that launched Pi",
        promptGuidelines: [
          "Use neovim for live editor state, unsaved selections, or source focus that Pi's disk-backed tools cannot observe.",
          "Treat neovim results as editor state and lsp results as independent language-server evidence.",
        ],
        parameters: NeovimParameters,
        executionMode: "sequential",

        async execute(_toolCallId, params, _signal, _onUpdate, context) {
          const bridge = channelFor(context);
          const result = await match(params)
            .with({ operation: "status" }, () => bridge.status())
            .with({ operation: "context" }, () => bridge.context())
            .with({ operation: "focus_context" }, () => bridge.focusContext())
            .with({ operation: "selection" }, () => bridge.selection())
            .exhaustive();
          return {
            content: [{ type: "text", text: resultText(result) }],
            details: resultDetails(params.operation, result),
          };
        },
      }),
    );

    pi.on("session_shutdown", async () => {
      const activeChannel = channel;
      channel = undefined;
      await activeChannel?.close();
    });
  };
}

export default createNeovimExtension();
