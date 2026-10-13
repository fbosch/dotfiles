import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Container,
  getCapabilities,
  Image,
  setCapabilities,
  type Terminal,
  TuiAltScreen,
} from "@earendil-works/pi-tui";
import { installImageOpenClickHandler } from "../open-image";

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

  test("opens only a clicked image area from tool output via the injected opener", async () => {
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
      platform: "linux",
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
    const image = new Image(
      base64,
      "image/png",
      { fallbackColor: (text) => text },
      {
        maxWidthCells: 10,
      },
    );
    const content = new Container();
    content.addChild(image);
    tui.addChild(content);

    try {
      tui.start();
      tui.renderNow();
      sendClick(terminal, 12, 2);
      sendClick(terminal, 3, 2);
      await openedOnce;

      expect(opened).toHaveLength(1);
      expect(opened[0]?.bytes).toEqual(bytes);
      expect(opened[0]?.path).toEndWith(".png");
      expect(opened[0]?.mode).toBe(0o600);
      expect(notifications).toEqual([]);
    } finally {
      tui.stop();
      setCapabilities(previousCapabilities);
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not install on non-Linux systems", () => {
    const image = Image.prototype as unknown as { handleMouse?: unknown };
    const previous = image.handleMouse;
    const dispose = installImageOpenClickHandler({
      platform: "darwin",
      notify: () => {},
    });
    dispose();
    expect(image.handleMouse).toBe(previous);
  });
});
