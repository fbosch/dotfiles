import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { activeUrlHandler, trackUrlHandler } from "../../lib/tui-url-handler";
import type { BridgeResult } from "./contracts";

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || (code >= 127 && code <= 159);
  });
}

function localFilePath(value: string): string | undefined {
  if (hasControlCharacters(value)) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "file:" ||
      (url.hostname !== "" && url.hostname !== "localhost") ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return undefined;
    }
    // Bun's fileURLToPath accepts malformed percent escapes that Node rejects.
    decodeURIComponent(url.pathname);
    const path = fileURLToPath(url);
    return isAbsolute(path) &&
      Buffer.byteLength(path, "utf8") <= 4096 &&
      !hasControlCharacters(path)
      ? path
      : undefined;
  } catch {
    return undefined;
  }
}

export function installNeovimFileLinks(
  tui: TUI,
  context: ExtensionContext,
  openFile: (path: string) => Promise<BridgeResult<true>>,
): () => void {
  const target = tui as TUI & { openUrl?: (url: string) => void };
  if (tui.mode !== "fullscreen" || typeof target.openUrl !== "function") return () => {};

  const original = activeUrlHandler(target.openUrl);
  const state = { disposed: false, ...(original === undefined ? {} : { original }) };
  let pending = Promise.resolve();
  const handler = (url: string) => {
    const path = state.disposed ? undefined : localFilePath(url);
    if (path === undefined) {
      state.original?.call(tui, url);
      return;
    }
    pending = pending.then(async () => {
      if (state.disposed) return;
      try {
        const result = await openFile(path);
        if (!state.disposed && !result.ok) {
          context.ui.notify(`Could not open file in Neovim: ${result.error.message}`, "error");
        }
      } catch {
        if (!state.disposed) context.ui.notify("Could not open file in Neovim.", "error");
      }
    });
  };
  // TuiAltScreen reads this private field at mouse release; Pi has no public link hook.
  trackUrlHandler(handler, state);
  target.openUrl = handler;
  return () => {
    state.disposed = true;
    if (target.openUrl === handler) {
      const previous = activeUrlHandler(state.original);
      if (previous === undefined) delete target.openUrl;
      else target.openUrl = previous;
    }
  };
}
