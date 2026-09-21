import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getKeybindings, type TUI } from "@earendil-works/pi-tui";
import { installFloatingDialogs } from "./floating-dialogs";
import {
  type FooterCustomization,
  HIDDEN_FOOTER_STATUS_KEYS,
  loadFooterCustomization,
} from "./footer-config";
import { installSubagentWidgetFrame } from "./subagent-widget-frame";

const WORKING_PULSE_FRAMES = ["·", "•", "●", "•"] as const;
const WORKING_PULSE_INTERVAL_MS = 120;
const PROFILE_STATUS_KEY = "auth-profile";
const STARTUP_TIME_STATUS_KEY = "startup-time";

export default function promptUi(pi: ExtensionAPI): void {
  let isWorking = false;
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
  const state = {
    isWorking: () => isWorking,
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
    stopWorkingPulse();
    activeTui?.requestRender();
  });

  // Custom compaction can finish after agent_settled; redraw the live usage counter then.
  pi.on("session_compact", () => {
    activeTui?.requestRender();
  });

  pi.on("session_shutdown", () => {
    stopWorkingPulse();
    disposePromptEditor();
    disposePromptEditor = () => {};
    disposeSubagentWidgetFrame();
    disposeSubagentWidgetFrame = () => {};
    activeTui = undefined;
  });

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    const { loadTypoCorrectionRules } = await import("../typo-abolish");
    const typoRules = loadTypoCorrectionRules();
    const {
      FILE_CHANGES_STATUS_KEY,
      MCP_STATUS_KEY,
      PromptEditor,
      renderFooterStatus,
      renderPromptHints,
    } = await import("./prompt-editor");

    let footerCustomization: FooterCustomization | undefined;
    try {
      footerCustomization = loadFooterCustomization(ctx);
    } catch (error) {
      ctx.ui.notify?.(
        `Could not load footer customization: ${error instanceof Error ? error.message : String(error)}`,
        "warning",
      );
    }

    installFloatingDialogs(ctx.ui);
    disposeSubagentWidgetFrame();
    disposeSubagentWidgetFrame = installSubagentWidgetFrame(ctx.ui, {
      cwd: ctx.cwd,
      includeProjectAgents: ctx.isProjectTrusted(),
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
              HIDDEN_FOOTER_STATUS_KEYS.has(key) === false &&
              key !== PROFILE_STATUS_KEY &&
              key !== FILE_CHANGES_STATUS_KEY &&
              key !== MCP_STATUS_KEY &&
              key !== STARTUP_TIME_STATUS_KEY,
          )
          .map(([key, status]) => renderFooterStatus(theme, key, status));
      getMcpStatus = () => {
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
            footerCustomization,
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
