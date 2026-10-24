import {
  type ExtensionUIContext,
  InteractiveMode,
  type ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

export type ToolRendererLookup = (
  name: string,
) => ConstructorParameters<typeof ToolExecutionComponent>[4];
type CustomUI = ExtensionUIContext["custom"];
type CustomCall = (...args: Parameters<CustomUI>) => ReturnType<CustomUI>;
const bridgeKey = Symbol.for("dotfiles:minimal-subagents:main-window-renderers");

interface RendererHost {
  ui: TUI;
  getRegisteredToolDefinition: ToolRendererLookup;
  showExtensionCustom: CustomCall;
  [bridgeKey]?: WeakMap<TUI, ToolRendererLookup>;
}

// Pi 1.3.0 exposes renderer registration but no extension-side lookup. Keep this
// private UI bridge isolated until Pi offers one; resolve through the main window
// so built-in defaults and extension resolver ordering stay identical.
export function installMainWindowRendererAccess(
  target: unknown = InteractiveMode.prototype,
): (tui: TUI) => ToolRendererLookup {
  if (
    typeof target !== "object" ||
    target === null ||
    !("showExtensionCustom" in target) ||
    typeof target.showExtensionCustom !== "function" ||
    !("getRegisteredToolDefinition" in target) ||
    typeof target.getRegisteredToolDefinition !== "function"
  ) {
    throw new Error("Main-window tool renderer access is unavailable in this Pi version");
  }
  const prototype = target as RendererHost;
  let lookups = prototype[bridgeKey];
  if (!lookups) {
    lookups = new WeakMap<TUI, ToolRendererLookup>();
    const registry = lookups;
    const original = prototype.showExtensionCustom;
    prototype.showExtensionCustom = function (this: RendererHost, ...args) {
      registry.set(this.ui, (name) => this.getRegisteredToolDefinition(name));
      return original.apply(this, args);
    };
    Object.defineProperty(prototype, bridgeKey, { value: lookups });
  }
  const registry = lookups;
  return (tui) => {
    const lookup = registry.get(tui);
    if (!lookup) throw new Error("Subagent transcript is not attached to a main-window renderer");
    return lookup;
  };
}
