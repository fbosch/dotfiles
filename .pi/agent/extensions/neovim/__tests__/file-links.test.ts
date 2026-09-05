import { expect, test } from "bun:test";
import { pathToFileURL } from "node:url";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { hyperlink, type Terminal, Text, type TUI, TuiAltScreen } from "@earendil-works/pi-tui";
import {
  installSubagentSessionUrlHandler,
  subagentSessionUrl,
} from "../../prompt-ui/subagent-session-links";
import { installNeovimFileLinks } from "../file-links";

const imagePath = "/tmp/pi-clipboard-63bb0b66-b11e-4c53-ae13-a5d09220fbc2.png";
const imageUrl = pathToFileURL(imagePath).href;
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function fixture(mode = "fullscreen") {
  const external: string[] = [];
  const opened: string[] = [];
  const notifications: string[] = [];
  const original = (url: string) => {
    external.push(url);
  };
  const tui = { mode, openUrl: original };
  const context = {
    ui: { notify: (message: string) => notifications.push(message) },
  } as unknown as ExtensionContext;
  const openFile = async (path: string) => {
    opened.push(path);
    return { ok: true, value: true } as const;
  };
  return { context, external, notifications, opened, openFile, original, tui };
}

test("opens local file URLs with literal spaces, Danish letters, and metacharacters", async () => {
  const f = fixture();
  const dispose = installNeovimFileLinks(f.tui as unknown as TUI, f.context, f.openFile);
  const literalPath = "/tmp/æ ø å # % | ' \".png";
  f.tui.openUrl(imageUrl);
  f.tui.openUrl(pathToFileURL(literalPath).href);
  f.tui.openUrl("file://localhost/tmp/local.png");
  await settle();
  expect(f.opened).toEqual([imagePath, literalPath, "/tmp/local.png"]);
  expect(f.external).toEqual([]);
  dispose();
  expect(f.tui.openUrl).toBe(f.original);
});

test("leaves web, remote, malformed, and unsupported URLs with the previous handler", async () => {
  const f = fixture();
  const dispose = installNeovimFileLinks(f.tui as unknown as TUI, f.context, f.openFile);
  const urls = [
    "https://example.com/file.png",
    "file://other-host/tmp/file.png",
    "file:///tmp/file.png#L10",
    "file:///tmp/file.png?query=1",
    "file:///tmp/%zz.png",
    "file:///tmp/encoded%2fslash.png",
    "file:///tmp/null%00.png",
    "file:///tmp/new%0aline.png",
    "file:///tmp/raw\tname.png",
    `file:///tmp/${"a".repeat(4096)}`,
    "not a URL",
  ];
  for (const url of urls) f.tui.openUrl(url);
  await settle();
  expect(f.opened).toEqual([]);
  expect(f.external).toEqual(urls);
  dispose();
});

test("does not patch regular mode or a fullscreen implementation without openUrl", () => {
  const f = fixture("regular");
  installNeovimFileLinks(f.tui as unknown as TUI, f.context, f.openFile)();
  expect(f.tui.openUrl).toBe(f.original);
  const unsupported = { mode: "fullscreen" };
  installNeovimFileLinks(unsupported as TUI, f.context, f.openFile)();
  expect(unsupported).toEqual({ mode: "fullscreen" });
});

test("reports open failures without opening externally and continues after rejection", async () => {
  const f = fixture();
  let attempt = 0;
  const dispose = installNeovimFileLinks(f.tui as unknown as TUI, f.context, async () => {
    if (attempt++ === 0) throw new Error("disconnected");
    return {
      ok: false,
      error: { code: "NVIM_UNAVAILABLE", message: "The bound Neovim instance disconnected" },
    };
  });
  f.tui.openUrl(imageUrl);
  f.tui.openUrl(imageUrl);
  await settle();
  expect(f.notifications).toEqual([
    "Could not open file in Neovim.",
    "Could not open file in Neovim: The bound Neovim instance disconnected",
  ]);
  expect(f.external).toEqual([]);
  dispose();
});

test("shutdown cancels queued clicks and silences an in-flight open failure", async () => {
  const f = fixture();
  let finish: (() => void) | undefined;
  const dispose = installNeovimFileLinks(f.tui as unknown as TUI, f.context, async (path) => {
    f.opened.push(path);
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    throw new Error("closed");
  });
  f.tui.openUrl(imageUrl);
  f.tui.openUrl(imageUrl);
  await settle();
  dispose();
  finish?.();
  await settle();
  expect(f.opened).toEqual([imagePath]);
  expect(f.notifications).toEqual([]);
});

for (const neovimFirst of [true, false]) {
  test(`composes with subagent links and reloads without stale callbacks (${neovimFirst})`, async () => {
    const f = fixture();
    const tui = f.tui as unknown as TUI;
    const target = { agentId: "agent-1", displayName: "Explore", description: "Inspect" };
    const sessions: unknown[] = [];
    const installFile = () => installNeovimFileLinks(tui, f.context, f.openFile);
    const installSession = () =>
      installSubagentSessionUrlHandler(tui, (value) => sessions.push(value));
    const [disposeFirst, disposeSecond] = neovimFirst
      ? [installFile(), installSession()]
      : [installSession(), installFile()];
    f.tui.openUrl(imageUrl);
    f.tui.openUrl(subagentSessionUrl(target));
    f.tui.openUrl("https://example.com");
    await settle();
    expect(f.opened).toEqual([imagePath]);
    expect(sessions).toEqual([target]);
    expect(f.external).toEqual(["https://example.com"]);
    disposeFirst();
    disposeSecond();
    const disposeReloaded = installFile();
    f.tui.openUrl(imageUrl);
    await settle();
    expect(f.opened).toEqual([imagePath, imagePath]);
    disposeReloaded();
    // The Neovim wrapper must not accumulate after another extension restores it.
    if (neovimFirst) expect(f.tui.openUrl).toBe(f.original);
  });
}

class TestTerminal implements Terminal {
  readonly columns = 100;
  readonly rows = 10;
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

test("an actual fullscreen OSC-8 mouse click opens the clipboard image only once", async () => {
  const f = fixture();
  const terminal = new TestTerminal();
  const tui = new TuiAltScreen(terminal, false, undefined, { openUrl: f.original });
  const dispose = installNeovimFileLinks(tui, f.context, f.openFile);
  tui.addChild(new Text(hyperlink(imagePath, imageUrl), 0, 0));
  try {
    tui.start();
    tui.renderNow();
    terminal.send("\u001b[<0;2;1M");
    terminal.send("\u001b[<0;2;1m");
    await settle();
    expect(f.opened).toEqual([imagePath]);
    expect(f.external).toEqual([]);
  } finally {
    dispose();
    tui.stop();
  }
});
