import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installImageOpenClickHandler } from "./open-image";

export default function imageViewerExtension(pi: ExtensionAPI): void {
  if (process.platform !== "linux") return;

  let dispose: (() => void) | undefined;
  pi.on("session_start", (_event, context) => {
    dispose?.();
    dispose = undefined;
    if (context.mode !== "tui" || !context.hasUI) return;

    dispose = installImageOpenClickHandler({
      notify: (message) => context.ui.notify(message, "error"),
    });
  });
  pi.on("session_shutdown", () => {
    dispose?.();
    dispose = undefined;
  });
}
