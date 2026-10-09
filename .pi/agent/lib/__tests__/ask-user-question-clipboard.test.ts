import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import type { NativeClipboard } from "@earendil-works/pi-tui";
import { readClipboardPaste } from "../ask-user-question-clipboard";

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

function createClipboard(overrides: Partial<NativeClipboard> = {}): NativeClipboard {
  return {
    getText: async () => null,
    getImage: async () => null,
    ...overrides,
  };
}

describe("ask-user-question clipboard paste", () => {
  test("preserves a single copied file path", async () => {
    const filePath = "/tmp/copied image.png";
    const clipboard = createClipboard({ getFilePaths: async () => [filePath] });

    await expect(readClipboardPaste({ clipboard, waylandSession: false })).resolves.toBe(filePath);
  });

  test("saves Wayland image data as a private temporary file", async () => {
    const commands: string[] = [];
    const runClipboardCommand = async (command: string, args: string[]) => {
      commands.push(`${command} ${args.join(" ")}`);
      return args[0] === "--list-types" ? Buffer.from("image/png\n") : pngBytes;
    };

    const filePath = await readClipboardPaste({
      clipboard: createClipboard(),
      waylandSession: true,
      runClipboardCommand,
    });
    if (filePath === undefined) throw new Error("Clipboard image was not saved");

    try {
      expect(filePath).toMatch(/\.png$/u);
      expect(readFileSync(filePath)).toEqual(pngBytes);
      expect(commands).toEqual(["wl-paste --list-types", "wl-paste --type image/png --no-newline"]);
    } finally {
      rmSync(filePath, { force: true });
    }
  });
});
