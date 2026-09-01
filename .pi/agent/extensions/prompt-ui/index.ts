import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getKeybindings, type TUI } from "@earendil-works/pi-tui";
import { PromptEditor, type PromptEditorState, renderPromptHints } from "./prompt-editor";

export default function promptUi(pi: ExtensionAPI): void {
  let isWorking = false;
  let activeTui: TUI | undefined;
  let disposePromptEditor = () => {};
  let getBranch = (): string | null => null;
  let getStatuses = (): readonly string[] => [];
  const state: PromptEditorState = {
    isWorking: () => isWorking,
    getBranch: () => getBranch(),
    getStatuses: () => getStatuses(),
  };

  pi.on("agent_start", () => {
    isWorking = true;
    activeTui?.requestRender();
  });

  pi.on("agent_settled", () => {
    isWorking = false;
    activeTui?.requestRender();
  });

  pi.on("session_shutdown", () => {
    disposePromptEditor();
    disposePromptEditor = () => {};
    activeTui = undefined;
  });

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setWorkingVisible(false);
    ctx.ui.setFooter((tui, _theme, footerData) => {
      const keybindings = getKeybindings();
      getBranch = () => footerData.getGitBranch();
      getStatuses = () => [...footerData.getExtensionStatuses().values()];
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

      return {
        render: (width) => [renderPromptHints(ctx.ui.theme, keybindings, state, width)],
        invalidate: () => tui.requestRender(),
        dispose: () => {
          unsubscribe();
          getBranch = () => null;
          getStatuses = () => [];
        },
      };
    });

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const editor = new PromptEditor(tui, theme, keybindings, pi, ctx, state);
      disposePromptEditor = () => editor.dispose();
      activeTui = tui;
      return editor;
    });
  });
}
