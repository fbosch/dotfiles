import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getKeybindings, type TUI } from "@earendil-works/pi-tui";
import { loadTypoCorrectionRules } from "../typo-abolish";
import { installFloatingDialogs } from "./floating-dialogs";
import {
  PromptEditor,
  type PromptEditorState,
  renderFooterStatus,
  renderPromptHints,
} from "./prompt-editor";
import { installSubagentWidgetFrame } from "./subagent-widget-frame";

const WORKING_PULSE_FRAMES = ["·", "•", "●", "•"] as const;
const WORKING_PULSE_INTERVAL_MS = 120;
const PROFILE_STATUS_KEY = "auth-profile";

export default function promptUi(pi: ExtensionAPI): void {
  const typoRules = loadTypoCorrectionRules();
  let isWorking = false;
  let workingPulseIndex = 0;
  let workingPulseTimer: ReturnType<typeof setInterval> | undefined;
  let activeTui: TUI | undefined;
  let disposePromptEditor = () => {};
  let disposeSubagentWidgetFrame = () => {};
  let getBranch = (): string | null => null;
  let getProfileName = (): string | undefined => undefined;
  let getStatuses = (): readonly string[] => [];
  const state: PromptEditorState = {
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

  pi.on("session_shutdown", () => {
    stopWorkingPulse();
    disposePromptEditor();
    disposePromptEditor = () => {};
    disposeSubagentWidgetFrame();
    disposeSubagentWidgetFrame = () => {};
    activeTui = undefined;
  });

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    installFloatingDialogs(ctx.ui);
    disposeSubagentWidgetFrame();
    disposeSubagentWidgetFrame = installSubagentWidgetFrame(ctx.ui, { cwd: ctx.cwd });
    ctx.ui.setWorkingVisible(false);
    ctx.ui.setFooter((tui, theme, footerData) => {
      const keybindings = getKeybindings();
      getBranch = () => footerData.getGitBranch();
      getProfileName = () => footerData.getExtensionStatuses().get(PROFILE_STATUS_KEY);
      getStatuses = () =>
        [...footerData.getExtensionStatuses().entries()]
          .filter(([key]) => key !== PROFILE_STATUS_KEY)
          // The permission package republishes this shared key as plain text on startup.
          .map(([key, status]) => renderFooterStatus(theme, key, status));
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

      return {
        render: (width) => [renderPromptHints(theme, keybindings, state, ctx.cwd, width)],
        invalidate: () => tui.requestRender(),
        dispose: () => {
          unsubscribe();
          getBranch = () => null;
          getProfileName = () => undefined;
          getStatuses = () => [];
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
