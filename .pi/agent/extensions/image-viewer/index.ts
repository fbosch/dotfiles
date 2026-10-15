import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installImageOpenClickHandler, isImageViewerPlatformSupported } from "./open-image";

export default function imageViewerExtension(pi: ExtensionAPI): void {
  if (!isImageViewerPlatformSupported(process.platform)) return;

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
