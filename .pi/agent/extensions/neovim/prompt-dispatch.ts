import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export type PromptDispatchFailureCode = "PI_BUSY" | "PI_NO_UI" | "PI_UNSUPPORTED";

export type PromptDispatchResult =
  | { readonly ok: true }
  | { readonly code: PromptDispatchFailureCode; readonly ok: false };

export function submitPrompt(
  pi: ExtensionAPI,
  context: ExtensionContext,
  text: string,
  blockingPromptActive: boolean,
): PromptDispatchResult {
  if (context.mode !== "tui" || context.hasUI === false) {
    return { code: "PI_NO_UI", ok: false };
  }
  if (blockingPromptActive || context.isIdle() === false) {
    return { code: "PI_BUSY", ok: false };
  }

  try {
    pi.sendUserMessage(text, { expandPromptTemplates: false });
    return { ok: true };
  } catch {
    return { code: "PI_UNSUPPORTED", ok: false };
  }
}

export function appendPrompt(context: ExtensionContext, text: string): PromptDispatchResult {
  if (context.mode !== "tui" || context.hasUI === false) {
    return { code: "PI_NO_UI", ok: false };
  }

  try {
    context.ui.setEditorText(context.ui.getEditorText() + text);
    return { ok: true };
  } catch {
    return { code: "PI_UNSUPPORTED", ok: false };
  }
}
