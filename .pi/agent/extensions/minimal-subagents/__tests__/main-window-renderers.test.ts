import { expect, test } from "bun:test";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { Text, TuiAltScreen, type Terminal } from "@earendil-works/pi-tui";
import { installMainWindowRendererAccess, type ToolRendererLookup } from "../main-window-renderers";

const terminal: Terminal = {
  columns: 100, rows: 30, kittyProtocolActive: false,
  start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {},
  clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {},
};
type CustomCall = (...args: Parameters<ExtensionUIContext["custom"]>) => ReturnType<ExtensionUIContext["custom"]>;

test("main-window bridge isolates windows, resolves dynamically, and installs once across reloads", async () => {
  const first = { renderCall: () => new Text("first") };
  const replacement = { renderCall: () => new Text("replacement") };
  const second = { renderCall: () => new Text("second") };
  const prototype = {
    getRegisteredToolDefinition(this: { definition: ReturnType<ToolRendererLookup> }) { return this.definition; },
    showExtensionCustom: (async function (this: { onOpen: () => void }) { this.onOpen(); return "closed"; }) as CustomCall,
  };
  const lookup = installMainWindowRendererAccess(prototype);
  const wrapped = prototype.showExtensionCustom;
  const afterReload = installMainWindowRendererAccess(prototype);
  expect(prototype.showExtensionCustom).toBe(wrapped);
  const windows = [first, second].map((definition) => ({
    ...prototype, ui: new TuiAltScreen(terminal, false), definition,
    onOpen() {},
  }));
  for (const window of windows) {
    window.onOpen = () => expect(lookup(window.ui)("read")).toBe(window.definition);
    expect(await window.showExtensionCustom(() => new Text(""))).toBe("closed");
  }
  windows[0]!.definition = replacement;
  expect(afterReload(windows[0]!.ui)("read")).toBe(replacement);
  expect(lookup(windows[1]!.ui)("read")).toBe(second);
  expect(() => lookup(new TuiAltScreen(terminal, false))).toThrow("not attached");
  expect(() => installMainWindowRendererAccess({})).toThrow("unavailable");
});

test("bridge uses the installed Pi main-window renderer resolver rather than copying definitions", async () => {
  const sdk: typeof import("@earendil-works/pi-coding-agent") = await import(process.env.PI_SUBAGENT_TEST_SDK ?? "@earendil-works/pi-coding-agent");
  const definition = { renderCall: () => new Text("registered hashline"), renderResult: () => new Text("hashline result") };
  const override = { renderCall: () => new Text("extension override") };
  let useOverride = false;
  const ui = new TuiAltScreen(terminal, false);
  const prototype = Object.create(sdk.InteractiveMode.prototype) as {
    showExtensionCustom: CustomCall;
    getRegisteredToolDefinition: ToolRendererLookup;
  };
  const opened: ReturnType<ToolRendererLookup>[] = [];
  const lookup = installMainWindowRendererAccess;
  // Only stub terminal presentation; use Pi's real main-window resolver.
  prototype.showExtensionCustom = async () => { opened.push(access(ui)("read")); };
  const access = lookup(prototype);
  const host = {
    getRegisteredToolDefinition: prototype.getRegisteredToolDefinition,
    ui,
    session: {
      getToolDefinition: () => definition,
      extensionRunner: {
        resolveToolRenderers: (_name: string, base: () => ReturnType<ToolRendererLookup>) => useOverride ? override : base(),
      },
    },
  };
  await prototype.showExtensionCustom.call(host, () => new Text(""));
  expect(opened[0]?.renderCall).toBe(definition.renderCall);
  expect(opened[0]?.renderResult).toBe(definition.renderResult);
  // The installed 1.3.0 host also applies extension-wide renderer resolvers.
  if (process.env.PI_SUBAGENT_TEST_SDK) {
    useOverride = true;
    await prototype.showExtensionCustom.call(host, () => new Text(""));
    expect(opened[1]?.renderCall).toBe(override.renderCall);
  }
});
