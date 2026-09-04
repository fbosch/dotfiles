import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { match } from "ts-pattern";
import { type Static, Type } from "typebox";
import { type NvimConnectionFactory, PiNeovimChannel } from "./channel";
import {
  type BridgeResult,
  DEFAULT_DIAGNOSTIC_SUMMARY_ITEMS,
  DEFAULT_QUICKFIX_ITEMS,
  MAX_DIAGNOSTIC_SUMMARY_ITEMS,
  MAX_QUICKFIX_ITEMS,
  type NeovimErrorCode,
} from "./contracts";

const NeovimParameters = Type.Union([
  Type.Object({ operation: Type.Literal("status") }, { additionalProperties: false }),
  Type.Object({ operation: Type.Literal("context") }, { additionalProperties: false }),
  Type.Object({ operation: Type.Literal("visible_windows") }, { additionalProperties: false }),
  Type.Object({ operation: Type.Literal("list_buffers") }, { additionalProperties: false }),
  Type.Object(
    {
      operation: Type.Literal("read_buffer"),
      buffer: Type.Integer({ minimum: 1 }),
      startLine: Type.Optional(Type.Integer({ minimum: 1 })),
      endLine: Type.Optional(Type.Integer({ minimum: 1 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      operation: Type.Literal("diagnostic_summary"),
      buffer: Type.Optional(Type.Integer({ minimum: 1 })),
      maxItems: Type.Optional(
        Type.Integer({
          default: DEFAULT_DIAGNOSTIC_SUMMARY_ITEMS,
          maximum: MAX_DIAGNOSTIC_SUMMARY_ITEMS,
          minimum: 1,
        }),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      operation: Type.Literal("diagnostics"),
      buffer: Type.Optional(Type.Integer({ minimum: 1 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      operation: Type.Literal("quickfix"),
      kind: Type.Optional(Type.Literal("quickfix")),
      maxItems: Type.Optional(
        Type.Integer({
          default: DEFAULT_QUICKFIX_ITEMS,
          maximum: MAX_QUICKFIX_ITEMS,
          minimum: 1,
        }),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      operation: Type.Literal("quickfix"),
      kind: Type.Literal("location"),
      maxItems: Type.Optional(
        Type.Integer({
          default: DEFAULT_QUICKFIX_ITEMS,
          maximum: MAX_QUICKFIX_ITEMS,
          minimum: 1,
        }),
      ),
      window: Type.Integer({ maximum: Number.MAX_SAFE_INTEGER, minimum: 1 }),
    },
    { additionalProperties: false },
  ),
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
    if (inheritedSocket === undefined || inheritedSocket === "") return;

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
          "Inspect live, in-memory state from the exact Neovim instance that launched this Pi session. Status reports connection identity. Context reports active or preserved source context and selection. Visible windows and listed buffers expose only worktree-contained source buffers. Read buffer returns up to 500 lines or 32 KiB, including unsaved edits. Diagnostic operations report Neovim's current vim.diagnostic state for unsaved buffers and do not query Pi's separate disk-backed LSP integration. Diagnostic summary counts a bounded editor set and returns 20 highest-priority items by default, at most 50; diagnostics returns a complete set only up to 500 items and 32 KiB. Quickfix returns the current global quickfix list by default; kind location requires its owning Neovim window. Problem lists return at most 20 entries by default and 50 when requested, with worktree-contained filenames and explicit list ownership. Diagnostic positions are one-based with end-exclusive ranges; missing quickfix positions remain zero. The socket is fixed by the launch environment and cannot be selected by tool input.",
        promptSnippet:
          "Inspect live context, unsaved buffers, and editor diagnostics from Pi's launching Neovim",
        promptGuidelines: [
          "Use neovim for live editor state, unsaved text or selections, and source focus that Pi's disk-backed tools cannot observe.",
          "Use one context call for source buffer, cursor, mode, and bounded selection; do not call status first unless connection identity or health is relevant.",
          "Use visible_windows to discover source shown in the current Neovim tab, list_buffers for other listed source buffers, and read_buffer only when in-memory text is needed.",
          "Use diagnostic_summary first to triage Neovim's current editor diagnostics; use diagnostics only when the complete bounded diagnostic set is needed.",
          "Use quickfix without a kind for the editor-global quickfix list. For a location list, set kind to location and pass the owning window from visible_windows.",
          "Treat neovim diagnostics as live editor state, including unsaved changes and non-LSP producers. Treat lsp diagnostics as independent evidence computed from project files on disk. Do not call both by default.",
        ],
        parameters: NeovimParameters,
        executionMode: "sequential",

        async execute(_toolCallId, params, _signal, _onUpdate, context) {
          const bridge = channelFor(context);
          const result = await match(params)
            .with({ operation: "status" }, () => bridge.status())
            .with({ operation: "context" }, () => bridge.context())
            .with({ operation: "visible_windows" }, () => bridge.visibleWindows())
            .with({ operation: "list_buffers" }, () => bridge.listBuffers())
            .with({ operation: "read_buffer" }, (options) => bridge.readBuffer(options))
            .with({ operation: "diagnostic_summary" }, (options) =>
              bridge.diagnosticSummary(options),
            )
            .with({ operation: "diagnostics" }, ({ buffer }) => bridge.diagnostics(buffer))
            .with({ operation: "quickfix" }, (options) => bridge.quickfix(options))
            .exhaustive();
          return {
            content: [{ type: "text", text: resultText(result) }],
            details: resultDetails(params.operation, result),
          };
        },
      }),
    );

    pi.on("session_start", async (_event, context) => {
      const bridge = channelFor(context);
      const sessionId = context.sessionManager.getSessionId();
      let result: Awaited<ReturnType<PiNeovimChannel["bindSession"]>> | undefined;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        result = await bridge.bindSession(sessionId);
        if (result.ok || result.error.code === "NVIM_UNAVAILABLE") break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (result?.ok === false) {
        context.ui.notify(
          `Could not bind Pi's session identity to Neovim: ${result.error.message}`,
          "warning",
        );
      }
    });

    pi.on("session_shutdown", async () => {
      const activeChannel = channel;
      channel = undefined;
      await activeChannel?.close();
    });
  };
}

export default createNeovimExtension();
