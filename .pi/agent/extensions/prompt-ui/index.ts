import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { getSandboxLaunchMode } from "../../lib/sandbox-mode";
import { installFloatingDialogs } from "./floating-dialogs";
import {
  type FooterCustomization,
  HIDDEN_FOOTER_STATUS_KEYS,
  loadFooterCustomization,
  renderSandboxFooterStatus,
} from "./footer-config";
import { gutterFade, WORKING_SWEEP_FRAMES } from "./working-gutter";

const WORKING_PULSE_INTERVAL_MS = 25;
const WORKING_FADE_MS = 400;
const INTERRUPT_HOLD_MS = 600;
const INTERRUPT_FADE_MS = 400;
const PROFILE_STATUS_KEY = "auth-profile";
const STARTUP_TIME_STATUS_KEY = "startup-time";

export default function promptUi(pi: ExtensionAPI): void {
  let isWorking = false;
  let workingPulseIndex = 0;
  let workingPulse = 0;
  let fadeInStartedAt = 0;
  let fadeInFrom = 0;
  let fadeStartedAt = 0;
  let fadeFrom = 0;
  let interruptStartedAt: number | undefined;
  let interruptPulse = 0;
  let workingPulseTimer: ReturnType<typeof setInterval> | undefined;
  let activeTui: TUI | undefined;
  let terminalFocused = true;
  let disposeFocusListener = () => {};
  let sessionGeneration = 0;
  let disposePromptEditor = () => {};
  let disposeAgentMentionCache = () => {};
  let invalidateContextUsage = () => {};
  let disposeMentionListener = () => {};
  let getBranch = (): string | null => null;
  let getProfileName = (): string | undefined => undefined;
  let getStatuses = (): readonly string[] => [];
  let getPrimaryStatus = (): string => "";
  let getFileChangesStatus = (): string => "";
  const state = {
    isWorking: () => isWorking,
    getWorkingPulse: () => workingPulse,
    getWorkingPosition: () => workingPulseIndex / WORKING_SWEEP_FRAMES,
    getInterruptPulse: () => interruptPulse,
    onInterrupt: () => {
      if (!isWorking) return;
      interruptStartedAt = performance.now();
      interruptPulse = 1;
      if (terminalFocused) activeTui?.requestRender();
    },
    getBranch: () => getBranch(),
    getProfileName: () => getProfileName(),
    getStatuses: () => getStatuses(),
  };

  const stopWorkingPulse = () => {
    if (workingPulseTimer === undefined) return;
    clearInterval(workingPulseTimer);
    workingPulseTimer = undefined;
  };

  const updateWorkingPulse = (advancePosition: boolean) => {
    const now = performance.now();
    if (isWorking) {
      if (advancePosition) workingPulseIndex = (workingPulseIndex + 1) % WORKING_SWEEP_FRAMES;
      workingPulse = 1 - (1 - fadeInFrom) * gutterFade(now - fadeInStartedAt, WORKING_FADE_MS);
    } else {
      workingPulse = fadeFrom * gutterFade(now - fadeStartedAt, WORKING_FADE_MS);
    }
    if (interruptStartedAt !== undefined) {
      interruptPulse = gutterFade(now - interruptStartedAt - INTERRUPT_HOLD_MS, INTERRUPT_FADE_MS);
      if (interruptPulse === 0) interruptStartedAt = undefined;
    }
  };

  const startWorkingPulse = () => {
    if (
      !terminalFocused ||
      activeTui === undefined ||
      workingPulseTimer !== undefined ||
      (!isWorking && workingPulse === 0 && interruptPulse === 0)
    ) {
      return;
    }
    workingPulseTimer = setInterval(() => {
      updateWorkingPulse(true);
      // Interrupt feedback must survive settlement until its own fade finishes.
      if (!isWorking && workingPulse === 0 && interruptPulse === 0) stopWorkingPulse();
      activeTui?.requestRender();
    }, WORKING_PULSE_INTERVAL_MS);
  };

  pi.on("agent_start", () => {
    stopWorkingPulse();
    isWorking = true;
    if (workingPulse === 0) workingPulseIndex = 0;
    fadeInFrom = workingPulse;
    fadeInStartedAt = performance.now();
    interruptStartedAt = undefined;
    interruptPulse = 0;
    startWorkingPulse();
    if (terminalFocused) activeTui?.requestRender();
  });

  pi.on("agent_settled", () => {
    // Boundary edits commit after message_end, so refresh again at final settlement.
    invalidateContextUsage();
    if (isWorking) {
      // Fade from the last displayed frame rather than snapping or restarting the pulse.
      fadeFrom = workingPulse;
      fadeStartedAt = performance.now();
      isWorking = false;
    }
    if (terminalFocused) activeTui?.requestRender();
  });

  // Custom compaction can finish after agent_settled; redraw the live usage counter then.
  pi.on("session_compact", () => {
    invalidateContextUsage();
    activeTui?.requestRender();
  });

  pi.on("message_start", () => invalidateContextUsage());
  pi.on("message_update", () => invalidateContextUsage());
  pi.on("message_end", () => invalidateContextUsage());
  pi.on("session_tree", () => {
    invalidateContextUsage();
    activeTui?.requestRender();
  });
  pi.on("session_shutdown", () => {
    sessionGeneration += 1;
    stopWorkingPulse();
    disposeFocusListener();
    disposeFocusListener = () => {};
    isWorking = false;
    workingPulse = 0;
    interruptStartedAt = undefined;
    interruptPulse = 0;
    disposePromptEditor();
    disposePromptEditor = () => {};
    invalidateContextUsage = () => {};
    disposeMentionListener();
    disposeMentionListener = () => {};
    disposeAgentMentionCache();
    disposeAgentMentionCache = () => {};
    activeTui = undefined;
  });

  pi.on("session_start", async (_event, ctx) => {
    const generation = ++sessionGeneration;
    stopWorkingPulse();
    disposeFocusListener();
    disposeFocusListener = () => {};
    disposePromptEditor();
    disposePromptEditor = () => {};
    invalidateContextUsage = () => {};
    disposeMentionListener();
    disposeMentionListener = () => {};
    disposeAgentMentionCache();
    disposeAgentMentionCache = () => {};
    activeTui = undefined;
    if (!ctx.hasUI) return;

    if (ctx.mode === "tui") {
      // Observe without consuming: Pi still needs focus reports for its own cleanup.
      disposeFocusListener = ctx.ui.onTerminalInput((data) => {
        if (data !== "\u001b[I" && data !== "\u001b[O") return;
        const focused = data === "\u001b[I";
        if (focused === terminalFocused) return;
        terminalFocused = focused;
        if (!focused) {
          stopWorkingPulse();
          return;
        }
        // Expire fades by elapsed time, but resume the sweep at its frozen position.
        updateWorkingPulse(false);
        startWorkingPulse();
        activeTui?.requestRender();
      });
    }

    disposeMentionListener = pi.events.on("dotfiles:mentions-changed", () => {
      activeTui?.invalidate();
      activeTui?.requestRender();
    });
    const { loadTypoCorrectionRules } = await import("../typo-abolish");
    const { AgentMentionCache } = await import("../mentions/agent-mentions");
    const agentMentionCache = new AgentMentionCache(
      ctx.cwd,
      getAgentDir(),
      ctx.isProjectTrusted?.() ?? false,
    );
    await agentMentionCache.start();
    if (generation !== sessionGeneration) {
      agentMentionCache.dispose();
      return;
    }
    disposeAgentMentionCache = () => agentMentionCache.dispose();
    const typoRules = loadTypoCorrectionRules();
    const {
      FILE_CHANGES_STATUS_KEY,
      MCP_STATUS_KEY,
      PromptEditor,
      renderFooterStatus,
      renderPromptHints,
    } = await import("./prompt-editor");
    if (generation !== sessionGeneration) return;

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
    ctx.ui.setWorkingVisible(false);
    ctx.ui.setFooter((tui, theme, footerData) => {
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
      getPrimaryStatus = () => {
        const status = footerData.getExtensionStatuses().get(MCP_STATUS_KEY);
        return [
          status === undefined ? "" : renderFooterStatus(theme, MCP_STATUS_KEY, status),
          renderSandboxFooterStatus(theme, getSandboxLaunchMode()),
        ]
          .filter(Boolean)
          .join(" · ");
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
            state,
            ctx.cwd,
            width,
            getPrimaryStatus(),
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
          getPrimaryStatus = () => "";
          getFileChangesStatus = () => "";
        },
      };
    });

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const editor = new PromptEditor(
        tui,
        theme,
        keybindings,
        pi,
        ctx,
        state,
        typoRules,
        agentMentionCache,
      );
      disposePromptEditor = () => editor.dispose();
      invalidateContextUsage = () => editor.invalidateContextUsage();
      activeTui = tui;
      startWorkingPulse();
      return editor;
    });
  });
}
