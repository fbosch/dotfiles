import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getCapabilities,
  getCellDimensions,
  getPngDimensions,
  Image,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { calculateImageCellSize, isImageLine } from "@earendil-works/pi-tui/dist/terminal-image.js";

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_ENCODED_IMAGE_BYTES = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const MAX_TEMP_FILES = 24;
const MAX_TEMP_BYTES = 128 * 1024 * 1024;
const TEMP_FILE_TTL_MS = 15 * 60 * 1000;
const IMAGE_EXTENSIONS = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["image/avif", ".avif"],
  ["image/bmp", ".bmp"],
  ["image/tiff", ".tif"],
]);
const IMAGE_CLICK_PATCH = Symbol.for("@dotfiles/pi-image-viewer/image-click-patch");

type ImageMouseHandler = (this: Image, event: TuiMouseEvent) => TuiMouseEventResult | undefined;
type PatchableImagePrototype = { handleMouse?: ImageMouseHandler } & Record<symbol, unknown>;
type ImageDimensions = { widthPx: number; heightPx: number };
type ImageInternals = {
  base64Data: string;
  mimeType: string;
  dimensions: ImageDimensions;
  options: { maxWidthCells?: number; maxHeightCells?: number };
  cachedLines?: string[];
  cachedWidth?: number;
  pngData?: string;
};
type StoredImageFile = {
  bytes: number;
  timer: ReturnType<typeof setTimeout>;
};
type ImageOpenOptions = {
  notify: (message: string) => void;
  platform?: string;
  openFile?: (path: string) => Promise<void>;
  tempDirectory?: string;
};
type ImageMousePatch = {
  handler: ImageMouseHandler;
  dispose: () => void;
};

function imageInternals(image: Image): ImageInternals {
  // SAFETY: pi-tui Image stores these as ordinary fields used by render(); this extension only reads them.
  return image as unknown as ImageInternals;
}

function isImageDimensions(value: unknown): value is ImageDimensions {
  if (
    typeof value !== "object" ||
    value === null ||
    !("widthPx" in value) ||
    !("heightPx" in value)
  ) {
    return false;
  }
  return (
    typeof value.widthPx === "number" &&
    Number.isFinite(value.widthPx) &&
    value.widthPx > 0 &&
    typeof value.heightPx === "number" &&
    Number.isFinite(value.heightPx) &&
    value.heightPx > 0
  );
}

function imageBounds(image: Image): { columns: number; rows: number } | undefined {
  const capabilities = getCapabilities();
  if (capabilities.images === null) return undefined;

  // Image exposes no source or hit-test API; use its cached render and geometry fields.
  const internal = imageInternals(image);
  const firstLine = internal.cachedLines?.[0];
  if (
    firstLine === undefined ||
    !isImageLine(firstLine) ||
    typeof internal.cachedWidth !== "number" ||
    !Number.isFinite(internal.cachedWidth)
  ) {
    return undefined;
  }

  let dimensions: unknown = internal.dimensions;
  if (!isImageDimensions(dimensions)) return undefined;
  if (
    capabilities.images === "kitty" &&
    internal.mimeType !== "image/png" &&
    typeof internal.pngData === "string"
  ) {
    dimensions = getPngDimensions(internal.pngData) ?? dimensions;
  }
  if (!isImageDimensions(dimensions)) return undefined;

  const cells = getCellDimensions();
  const requestedWidth = internal.options.maxWidthCells;
  const maxWidthCells = Math.max(
    1,
    Math.min(
      internal.cachedWidth - 2,
      typeof requestedWidth === "number" && Number.isFinite(requestedWidth) ? requestedWidth : 60,
    ),
  );
  const requestedHeight = internal.options.maxHeightCells;
  const maxHeightCells =
    typeof requestedHeight === "number" && Number.isFinite(requestedHeight)
      ? requestedHeight
      : Math.max(1, Math.ceil((maxWidthCells * cells.widthPx) / cells.heightPx));

  return calculateImageCellSize(
    dimensions,
    maxWidthCells,
    maxHeightCells,
    cells,
    capabilities.images === "kitty",
  );
}

function imageBytes(image: Image): { bytes: Buffer; extension: string } {
  const internal = imageInternals(image);
  const extension = IMAGE_EXTENSIONS.get(internal.mimeType);
  if (extension === undefined) throw new Error(`Unsupported image type: ${internal.mimeType}`);
  if (
    internal.base64Data.length === 0 ||
    internal.base64Data.length > MAX_ENCODED_IMAGE_BYTES ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(internal.base64Data) ||
    internal.base64Data.length % 4 === 1
  ) {
    throw new Error("Image data is invalid or exceeds the 32 MiB limit.");
  }

  const bytes = Buffer.from(internal.base64Data, "base64");
  if (
    bytes.length === 0 ||
    bytes.length > MAX_IMAGE_BYTES ||
    bytes.toString("base64").replace(/=+$/u, "") !== internal.base64Data.replace(/=+$/u, "")
  ) {
    throw new Error("Image data is invalid or exceeds the 32 MiB limit.");
  }
  return { bytes, extension };
}

type SupportedPlatform = "linux" | "darwin";

export function getOpenCommand(platform: SupportedPlatform): "open" | "xdg-open" {
  return platform === "darwin" ? "open" : "xdg-open";
}

export function isImageViewerPlatformSupported(platform: string): platform is SupportedPlatform {
  return platform === "linux" || platform === "darwin";
}

function startExternalOpen(
  command: "open" | "xdg-open",
  path: string,
  onError: (error: Error) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [path], { detached: true, stdio: "ignore" });
    let started = false;
    let reported = false;
    const reportOnce = (error: Error) => {
      if (reported) return;
      reported = true;
      onError(error);
    };

    child.once("error", (error) => {
      if (started) reportOnce(error);
      else reject(error);
    });
    child.once("spawn", () => {
      started = true;
      child.unref();
      resolve();
    });
    child.once("close", (code, signal) => {
      if (started && code !== 0) {
        reportOnce(
          new Error(
            code === null
              ? `${command} was terminated by ${signal ?? "an unknown signal"}.`
              : `${command} exited with status ${code}.`,
          ),
        );
      }
    });
  });
}

function createImageFileStore(baseDirectory: string) {
  let directory: Promise<string> | undefined;
  const files = new Map<string, StoredImageFile>();
  const imagePaths = new WeakMap<Image, Promise<string>>();
  let totalBytes = 0;

  const removeFile = (path: string, entry: StoredImageFile): void => {
    if (files.get(path) !== entry) return;
    clearTimeout(entry.timer);
    files.delete(path);
    totalBytes -= entry.bytes;
    void rm(path, { force: true }).catch(() => {});
  };

  const getDirectory = (): Promise<string> => {
    directory ??= mkdtemp(join(baseDirectory, "pi-image-viewer-")).catch((error: unknown) => {
      directory = undefined;
      throw error;
    });
    return directory;
  };

  const createFile = async (image: Image): Promise<string> => {
    const { bytes, extension } = imageBytes(image);
    const path = join(await getDirectory(), `${randomUUID()}${extension}`);
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });

    const entry = {
      bytes: bytes.length,
      timer: setTimeout(() => removeFile(path, entry), TEMP_FILE_TTL_MS),
    };
    entry.timer.unref();
    files.set(path, entry);
    totalBytes += entry.bytes;
    while (files.size > MAX_TEMP_FILES || totalBytes > MAX_TEMP_BYTES) {
      const oldest = files.entries().next().value;
      if (oldest === undefined) break;
      removeFile(oldest[0], oldest[1]);
    }
    return path;
  };

  return {
    pathFor(image: Image): Promise<string> {
      const cached = imagePaths.get(image);
      if (cached !== undefined) {
        return cached.then((path) => (files.has(path) ? path : createFile(image)));
      }

      const created = createFile(image);
      imagePaths.set(image, created);
      return created.catch((error: unknown) => {
        if (imagePaths.get(image) === created) imagePaths.delete(image);
        throw error;
      });
    },
  };
}

function patchState(value: unknown): value is ImageMousePatch {
  return (
    typeof value === "object" &&
    value !== null &&
    "handler" in value &&
    typeof value.handler === "function" &&
    "dispose" in value &&
    typeof value.dispose === "function"
  );
}

export function installImageOpenClickHandler(options: ImageOpenOptions): () => void {
  const platform = options.platform ?? process.platform;
  if (!isImageViewerPlatformSupported(platform)) return () => {};

  // SAFETY: the Symbol.for key is reserved for this extension; Image.prototype accepts this click-handler state.
  const prototype = Image.prototype as unknown as PatchableImagePrototype;
  const previous = prototype[IMAGE_CLICK_PATCH];
  if (patchState(previous)) previous.dispose();

  const original = prototype.handleMouse;
  const store = createImageFileStore(options.tempDirectory ?? tmpdir());
  const command = getOpenCommand(platform);
  const openFile =
    options.openFile ??
    ((path: string) =>
      startExternalOpen(command, path, (error) =>
        options.notify(`Could not open image with ${command}: ${error.message}`),
      ));
  let disposed = false;
  let state: ImageMousePatch;

  const handler: ImageMouseHandler = function (event) {
    if (event.type !== "click" || event.button !== "left" || getCapabilities().images === null) {
      return original?.call(this, event);
    }

    const bounds = imageBounds(this);
    if (
      bounds === undefined ||
      event.x < 0 ||
      event.x >= bounds.columns ||
      event.y < 0 ||
      event.y >= bounds.rows
    ) {
      return original?.call(this, event);
    }

    void store
      .pathFor(this)
      .then(openFile)
      .catch((error: unknown) => {
        options.notify(
          `Could not open image: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    return { handled: true };
  };

  prototype.handleMouse = handler;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (prototype.handleMouse === handler) {
      if (original === undefined) delete prototype.handleMouse;
      else prototype.handleMouse = original;
    }
    if (prototype[IMAGE_CLICK_PATCH] === state) {
      prototype[IMAGE_CLICK_PATCH] = undefined;
    }
  };
  state = { handler, dispose };
  prototype[IMAGE_CLICK_PATCH] = state;
  return dispose;
}
