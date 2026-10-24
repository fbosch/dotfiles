import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js";
import {
  getCapabilities,
  Image,
  setCapabilities,
  type Terminal,
  TuiAltScreen,
} from "@earendil-works/pi-tui";
import {
  getOpenCommand,
  installImageOpenClickHandler,
  isImageViewerPlatformSupported,
} from "../open-image";

class TestTerminal implements Terminal {
  readonly columns = 80;
  readonly rows = 24;
  readonly kittyProtocolActive = false;
  private onInput: ((data: string) => void) | undefined;

  start(onInput: (data: string) => void): void {
    this.onInput = onInput;
  }

  send(data: string): void {
    this.onInput?.(data);
  }

  stop(): void {}
  async drainInput(): Promise<void> {}
  write(): void {}
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(): void {}
  setProgress(): void {}
  setProgramStatus(): void {}
}

function pngData(widthPx = 13, heightPx = 7): { base64: string; bytes: Buffer } {
  const bytes = Buffer.alloc(24);
  bytes.writeUInt32BE(widthPx, 16);
  bytes.writeUInt32BE(heightPx, 20);
  return { base64: bytes.toString("base64"), bytes };
}

function sendClick(terminal: TestTerminal, column: number, row: number): void {
  terminal.send(`\u001b[<0;${column};${row}M`);
  terminal.send(`\u001b[<0;${column};${row}m`);
}

describe("inline image viewer", () => {
  const disposers: Array<() => void> = [];

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  test("opens a clicked image block in Pi's tool output on macOS via the injected opener", async () => {
    const previousCapabilities = getCapabilities();
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    const root = await mkdtemp(join(tmpdir(), "pi-image-viewer-test-"));
    const { base64, bytes } = pngData();
    const opened: Array<{ path: string; bytes: Buffer; mode: number }> = [];
    const notifications: string[] = [];
    let resolveOpened: (() => void) | undefined;
    const openedOnce = new Promise<void>((resolve) => {
      resolveOpened = resolve;
    });

    const dispose = installImageOpenClickHandler({
      platform: "darwin",
      tempDirectory: root,
      notify: (message) => notifications.push(message),
      openFile: async (path) => {
        opened.push({
          path,
          bytes: await readFile(path),
          mode: (await stat(path)).mode & 0o777,
        });
        resolveOpened?.();
      },
    });
    disposers.push(dispose);

    const terminal = new TestTerminal();
    const tui = new TuiAltScreen(terminal, false, undefined, { openUrl: () => {} });
    const themeKey = Symbol.for("@earendil-works/pi-coding-agent:theme");
    const hadTheme = Reflect.has(globalThis, themeKey);
    const previousTheme = Reflect.get(globalThis, themeKey);
    Reflect.set(globalThis, themeKey, {
      fg: (_color: string, text: string) => text,
      bg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    });
    const toolRow = new ToolExecutionComponent(
      "image",
      "image-1",
      {},
      { imageWidthCells: 10 },
      undefined,
      { requestRender: () => undefined } as never,
      process.cwd(),
    );
    toolRow.updateResult({
      content: [{ type: "image", data: base64, mimeType: "image/png" }],
      isError: false,
    });
    tui.addChild(toolRow);
    const rendered = toolRow.render(80);
    const imageRow = rendered.findIndex((line) => line.includes("\u001b_G"));

    try {
      expect(imageRow).toBeGreaterThanOrEqual(0);
      tui.start();
      tui.renderNow();
      sendClick(terminal, 80, imageRow + 1);
      sendClick(terminal, 3, imageRow + 1);
      const didOpen = await Promise.race([
        openedOnce.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
      ]);

      expect(didOpen).toBe(true);
      expect(opened).toHaveLength(1);
      expect(opened[0]?.bytes).toEqual(bytes);
      expect(opened[0]?.path).toEndWith(".png");
      expect(opened[0]?.mode).toBe(0o600);
      expect(notifications).toEqual([]);
    } finally {
      tui.stop();
      if (hadTheme) Reflect.set(globalThis, themeKey, previousTheme);
      else Reflect.deleteProperty(globalThis, themeKey);
      setCapabilities(previousCapabilities);
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not install on unsupported platforms", () => {
    const image = Image.prototype as unknown as { handleMouse?: unknown };
    const previous = image.handleMouse;
    const dispose = installImageOpenClickHandler({
      platform: "win32",
      notify: () => {},
    });
    dispose();
    expect(image.handleMouse).toBe(previous);
  });
  test("uses the native opener for each supported platform", () => {
    expect(getOpenCommand("darwin")).toBe("open");
    expect(getOpenCommand("linux")).toBe("xdg-open");
  });
  test("supports macOS and Linux only", () => {
    expect(isImageViewerPlatformSupported("darwin")).toBe(true);
    expect(isImageViewerPlatformSupported("linux")).toBe(true);
    expect(isImageViewerPlatformSupported("win32")).toBe(false);
  });
});
