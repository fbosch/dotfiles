import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getKeybindings, type TUI } from "@earendil-works/pi-tui";
import { loadTypoCorrectionRules } from "../typo-abolish";
import { installFloatingDialogs } from "./floating-dialogs";
import {
  FILE_CHANGES_STATUS_KEY,
  MCP_STATUS_KEY,
  PromptEditor,
  type PromptEditorState,
  renderFooterStatus,
  renderMcpFooterStatus,
  renderPromptHints,
} from "./prompt-editor";
import { installSubagentWidgetFrame } from "./subagent-widget-frame";

const WORKING_PULSE_FRAMES = ["·", "•", "●", "•"] as const;
const WORKING_PULSE_INTERVAL_MS = 120;
const PROFILE_STATUS_KEY = "auth-profile";
// The MCP adapter publishes this versioned snapshot on Pi's shared event bus.
const MCP_STATUS_EVENT = "pi-mcp-adapter/status/v1";

type McpFooterSnapshot = {
  connectedCount: number;
  hasFailure: boolean;
};

function readMcpFooterSnapshot(value: unknown): McpFooterSnapshot | undefined {
  if (typeof value !== "object" || value === null) return undefined;

  const snapshot = value as Record<string, unknown>;
  const connectedCount = snapshot.connectedCount;
  if (
    snapshot.version !== 1 ||
    typeof connectedCount !== "number" ||
    !Number.isInteger(connectedCount) ||
    connectedCount < 0 ||
    !Array.isArray(snapshot.servers)
  ) {
    return undefined;
  }

  const hasFailure = snapshot.servers.some((server) => {
    if (typeof server !== "object" || server === null) return false;
    return (server as Record<string, unknown>).status === "failed";
  });
  return { connectedCount, hasFailure };
}

export default function promptUi(pi: ExtensionAPI): void {
  const typoRules = loadTypoCorrectionRules();
  let isWorking = false;
  let isInterruptPending = false;
  let workingPulseIndex = 0;
  let workingPulseTimer: ReturnType<typeof setInterval> | undefined;
  let activeTui: TUI | undefined;
  let disposePromptEditor = () => {};
  let disposeSubagentWidgetFrame = () => {};
  let getBranch = (): string | null => null;
  let getProfileName = (): string | undefined => undefined;
  let getStatuses = (): readonly string[] => [];
  let getMcpStatus = (): string => "";
  let getFileChangesStatus = (): string => "";
  let mcpFooterSnapshot: McpFooterSnapshot | undefined;
  let unsubscribeMcpStatus = () => {};
  const resetMcpFooterSnapshot = () => {
    unsubscribeMcpStatus();
    unsubscribeMcpStatus = () => {};
    mcpFooterSnapshot = undefined;
  };
  const state: PromptEditorState = {
    isWorking: () => isWorking,
    isInterruptPending: () => isInterruptPending,
    setInterruptPending: (pending) => {
      if (isInterruptPending === pending) return;
      isInterruptPending = pending;
      activeTui?.requestRender();
    },
    getWorkingMarker: () => WORKING_PULSE_FRAMES[workingPulseIndex] ?? WORKING_PULSE_FRAMES[0],
    getBranch: () => getBranch(),
    getProfileName: () => getProfileName(),
    getStatuses: () => getStatuses(),
  };

  const stopWorkingPulse = () => {
    if (workingPulseTimer === undefined) return;
    clearInterval(workingPulseTimer);
    workingPulseTimer = undefined;
  };

  pi.on("agent_start", () => {
    stopWorkingPulse();
    state.setInterruptPending(false);
    isWorking = true;
    workingPulseIndex = 0;
    workingPulseTimer = setInterval(() => {
      workingPulseIndex = (workingPulseIndex + 1) % WORKING_PULSE_FRAMES.length;
      activeTui?.requestRender();
    }, WORKING_PULSE_INTERVAL_MS);
    activeTui?.requestRender();
  });

  pi.on("agent_settled", () => {
    isWorking = false;
    state.setInterruptPending(false);
    stopWorkingPulse();
    activeTui?.requestRender();
  });

  // Custom compaction can finish after agent_settled; redraw the live usage counter then.
  pi.on("session_compact", () => {
    activeTui?.requestRender();
  });

  pi.on("session_shutdown", () => {
    state.setInterruptPending(false);
    stopWorkingPulse();
    resetMcpFooterSnapshot();
    disposePromptEditor();
    disposePromptEditor = () => {};
    disposeSubagentWidgetFrame();
    disposeSubagentWidgetFrame = () => {};
    activeTui = undefined;
  });

  pi.on("session_start", (_event, ctx) => {
    resetMcpFooterSnapshot();
    if (!ctx.hasUI) return;

    unsubscribeMcpStatus = pi.events.on(MCP_STATUS_EVENT, (value) => {
      const snapshot = readMcpFooterSnapshot(value);
      if (snapshot === undefined) return;
      mcpFooterSnapshot = snapshot;
      activeTui?.requestRender();
    });

    installFloatingDialogs(ctx.ui);
    disposeSubagentWidgetFrame();
    disposeSubagentWidgetFrame = installSubagentWidgetFrame(ctx.ui, {
      cwd: ctx.cwd,
      sessionId: ctx.sessionManager.getSessionId(),
    });
    ctx.ui.setWorkingVisible(false);
    ctx.ui.setFooter((tui, theme, footerData) => {
      const keybindings = getKeybindings();
      getBranch = () => footerData.getGitBranch();
      getProfileName = () => footerData.getExtensionStatuses().get(PROFILE_STATUS_KEY);
      getStatuses = () =>
        [...footerData.getExtensionStatuses().entries()]
          .filter(
            ([key]) =>
              key !== PROFILE_STATUS_KEY &&
              key !== FILE_CHANGES_STATUS_KEY &&
              key !== MCP_STATUS_KEY,
          )
          .map(([key, status]) => renderFooterStatus(theme, key, status));
      getMcpStatus = () => {
        const snapshot = mcpFooterSnapshot;
        if (snapshot !== undefined) {
          return renderMcpFooterStatus(theme, snapshot.connectedCount, snapshot.hasFailure);
        }
        const status = footerData.getExtensionStatuses().get(MCP_STATUS_KEY);
        return status === undefined ? "" : renderFooterStatus(theme, MCP_STATUS_KEY, status);
      };
      getFileChangesStatus = () => {
        const status = footerData.getExtensionStatuses().get(FILE_CHANGES_STATUS_KEY);
        return status === undefined
          ? ""
          : renderFooterStatus(theme, FILE_CHANGES_STATUS_KEY, status);
      };
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

      return {
        render: (width) => [
          renderPromptHints(
            theme,
            keybindings,
            state,
            ctx.cwd,
            width,
            getMcpStatus(),
            getFileChangesStatus(),
          ),
        ],
        invalidate: () => tui.requestRender(),
        dispose: () => {
          unsubscribe();
          getBranch = () => null;
          getProfileName = () => undefined;
          getStatuses = () => [];
          getMcpStatus = () => "";
          getFileChangesStatus = () => "";
        },
      };
    });

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const editor = new PromptEditor(tui, theme, keybindings, pi, ctx, state, typoRules);
      disposePromptEditor = () => editor.dispose();
      activeTui = tui;
      return editor;
    });
  });
}
