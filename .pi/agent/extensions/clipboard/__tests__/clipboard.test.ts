import { expect, test } from "bun:test";
import {
  readClipboardText,
  selectClipboardBackend,
  writeClipboardText,
  type ClipboardCommandRunner,
} from "../clipboard";

test("prefers the Wayland clipboard in a Wayland session", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runCommand: ClipboardCommandRunner = async (command, args) => {
    calls.push({ command, args });
    return "copied text";
  };

  const result = await readClipboardText({
    platform: "linux",
    env: { WAYLAND_DISPLAY: "wayland-1", DISPLAY: ":0" },
    isExecutable: (command) => command === "wl-copy" || command === "wl-paste",
    runCommand,
  });

  expect(result).toBe("copied text");
  expect(calls).toEqual([
    { command: "wl-paste", args: ["--no-newline", "--type", "text"] },
  ]);
});

test("selects xclip before xsel in an X11 session", () => {
  const backend = selectClipboardBackend({
    platform: "linux",
    env: { DISPLAY: ":0" },
    isExecutable: (command) => command === "xclip" || command === "xsel",
  });

  expect(backend).toEqual({
    name: "X11 (xclip)",
    read: { command: "xclip", args: ["-selection", "clipboard", "-o"] },
    write: { command: "xclip", args: ["-selection", "clipboard"] },
  });
});

test("writes text directly to the selected backend without a shell wrapper", async () => {
  let call:
    | { command: string; args: string[]; input: string | undefined }
    | undefined;
  const runCommand: ClipboardCommandRunner = async (command, args, options) => {
    call = { command, args, input: options.input };
    return "";
  };

  await writeClipboardText("text to copy", {
    platform: "darwin",
    env: {},
    isExecutable: (command) => command === "pbcopy" || command === "pbpaste",
    runCommand,
  });

  expect(call).toEqual({ command: "pbcopy", args: [], input: "text to copy" });
});

test("fails clearly when no backend is available", () => {
  expect(() =>
    selectClipboardBackend({
      platform: "linux",
      env: {},
      isExecutable: () => false,
    }),
  ).toThrow(/No supported clipboard backend/u);
});
