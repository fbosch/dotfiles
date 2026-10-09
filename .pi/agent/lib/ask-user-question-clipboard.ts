import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getNativeClipboard, type NativeClipboard } from "@earendil-works/pi-tui";

const CLIPBOARD_TIMEOUT_MS = 5_000;
const MAX_CLIPBOARD_BYTES = 50 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

type ClipboardImage = {
  bytes: Uint8Array;
  mimeType: string;
};

type ClipboardPasteDependencies = {
  clipboard?: NativeClipboard;
  waylandSession?: boolean;
  runClipboardCommand?: typeof runClipboardCommand;
};

function isWaylandSession(): boolean {
  return (
    process.platform === "linux" &&
    (process.env.WAYLAND_DISPLAY !== undefined || process.env.XDG_SESSION_TYPE === "wayland")
  );
}

function runClipboardCommand(command: string, args: string[]): Promise<Buffer | undefined> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let length = 0;
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

    const finish = (result: Buffer | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const abort = () => {
      child.kill("SIGKILL");
      child.stdout?.destroy();
      finish(undefined);
    };

    timer = setTimeout(abort, CLIPBOARD_TIMEOUT_MS);
    child.on("error", () => finish(undefined));
    child.on("close", (code) => {
      if (settled) return;
      finish(code === 0 ? Buffer.concat(chunks, length) : undefined);
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      if (settled) return;
      length += chunk.length;
      if (length > MAX_CLIPBOARD_BYTES) {
        abort();
        return;
      }
      chunks.push(chunk);
    });
  });
}

async function readWaylandClipboardImage(
  runCommand: typeof runClipboardCommand,
): Promise<ClipboardImage | null | undefined> {
  const listedTypes = await runCommand("wl-paste", ["--list-types"]);
  if (listedTypes === undefined) return undefined;

  const types = listedTypes
    .toString("utf8")
    .split(/\r?\n/u)
    .map((type) => type.split(";")[0]?.trim() ?? "")
    .filter((type) => type.startsWith("image/"));
  const mimeType = types.find((type) => SUPPORTED_IMAGE_TYPES.has(type));
  if (mimeType === undefined) {
    if (types.length > 0) throw new Error("Unsupported clipboard image format");
    return null;
  }

  const bytes = await runCommand("wl-paste", ["--type", mimeType, "--no-newline"]);
  return bytes === undefined || bytes.length === 0 ? null : { bytes, mimeType };
}

function detectImageMimeType(bytes: Uint8Array): string | undefined {
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (bytes[0] === 0x89 && ascii(1, 7) === "PNG\r\n\x1a\n") {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  return undefined;
}

async function readClipboardImage(
  clipboard: NativeClipboard | undefined,
  waylandSession: boolean,
  runCommand: typeof runClipboardCommand,
): Promise<ClipboardImage | null> {
  if (waylandSession) {
    const waylandImage = await readWaylandClipboardImage(runCommand);
    // Avoid falling through to a stale X11 selection when Wayland has no image.
    if (waylandImage !== undefined) return waylandImage;
  }

  const bytes = await clipboard?.getImage();
  if (bytes === undefined || bytes === null || bytes.length === 0) return null;

  const mimeType = detectImageMimeType(bytes);
  if (mimeType === undefined) throw new Error("Unsupported clipboard image format");
  return { bytes, mimeType };
}

function saveClipboardImage(image: ClipboardImage): string {
  const extensions: Record<string, string> = {
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  const extension = extensions[image.mimeType];
  if (extension === undefined) throw new Error("Unsupported clipboard image format");

  const filePath = join(tmpdir(), `pi-clipboard-${randomUUID()}.${extension}`);
  writeFileSync(filePath, image.bytes, { flag: "wx", mode: 0o600 });
  return filePath;
}

async function readClipboardText(
  clipboard: NativeClipboard | undefined,
  waylandSession: boolean,
  runCommand: typeof runClipboardCommand,
): Promise<string | undefined> {
  if (waylandSession) {
    const text = await runCommand("wl-paste", ["--no-newline", "--type", "text"]);
    if (text !== undefined) return text.toString("utf8") || undefined;
  }

  return (await clipboard?.getText()) || undefined;
}

export async function readClipboardPaste(
  dependencies: ClipboardPasteDependencies = {},
): Promise<string | undefined> {
  const clipboard = dependencies.clipboard ?? getNativeClipboard();
  const waylandSession = dependencies.waylandSession ?? isWaylandSession();
  const runCommand = dependencies.runClipboardCommand ?? runClipboardCommand;
  const filePaths = await clipboard?.getFilePaths?.();
  if (filePaths !== undefined && filePaths !== null && filePaths.length > 0) {
    if (filePaths.length !== 1 || /\p{Cc}/u.test(filePaths[0] ?? "")) {
      throw new Error("Unsupported clipboard file paths");
    }
    return filePaths[0];
  }

  const image = await readClipboardImage(clipboard, waylandSession, runCommand);
  if (image !== null) return saveClipboardImage(image);

  return readClipboardText(clipboard, waylandSession, runCommand);
}
