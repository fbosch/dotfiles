import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Component, getCapabilities, Image, setCapabilities } from "@earendil-works/pi-tui";
import { openImageWithBroker } from "../desktop-image";
import { installImageOpenClickHandler } from "../open-image";

const roots: string[] = [];
const endpoints: string[] = [];
const servers: Server[] = [];
const sockets = new Set<Socket>();
const disposers: Array<() => void> = [];
const capabilities = getCapabilities();
afterEach(async () => {
  for (const dispose of disposers.splice(0)) dispose();
  setCapabilities(capabilities);
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const endpoint of endpoints.splice(0)) rmSync(endpoint, { force: true });
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type Request = {
  id: string;
  method: string;
  params: { imageId: string; offset: number; totalBytes: number; data: string };
};
async function broker(
  reply: (request: Request, socket: Socket, frameBytes: number) => void,
): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "pi-image-test-"));
  roots.push(root);
  const endpoint = join(process.env.AGENT_BROWSER_SOCKET_DIR || root, `${randomUUID()}.sock`);
  endpoints.push(endpoint);
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    let frame = "";
    socket.on("data", (chunk) => {
      frame += chunk.toString();
      if (frame.endsWith("\n")) reply(JSON.parse(frame), socket, Buffer.byteLength(frame));
    });
  });
  servers.push(server);
  server.listen(endpoint);
  await once(server, "listening");
  return endpoint;
}
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
function click() {
  const image: Component = new Image(png, "image/png", { fallbackColor: (text) => text });
  image.render(80);
  expect(
    image.handleMouse?.({
      type: "click",
      button: "left",
      x: 0,
      y: 0,
      screenX: 0,
      screenY: 0,
      width: 80,
      height: 1,
      shift: false,
      alt: false,
      ctrl: false,
    }),
  ).toEqual({ handled: true });
}

test("large images use ordered bounded chunks without file paths or commands", async () => {
  const received: Buffer[] = [];
  const ids = new Set<string>();
  let offset = 0;
  const image = Buffer.alloc(130000, 17);
  const endpoint = await broker((request, socket, frameBytes) => {
    expect(request.method).toBe("image.open");
    expect(Object.keys(request.params).sort()).toEqual(["data", "imageId", "offset", "totalBytes"]);
    expect(frameBytes).toBeLessThan(65536);
    expect(request.params.offset).toBe(offset);
    expect(request.params.totalBytes).toBe(image.length);
    ids.add(request.params.imageId);
    const bytes = Buffer.from(request.params.data, "base64");
    received.push(bytes);
    offset += bytes.length;
    socket.end(
      `${JSON.stringify({ id: request.id, ok: true, result: { complete: offset === image.length } })}\n`,
    );
  });
  await openImageWithBroker(endpoint, image);
  expect(Buffer.concat(received)).toEqual(image);
  expect(ids.size).toBe(1);
});

for (const response of [
  "denied",
  "mismatched-id",
  "malformed",
  "oversized",
  "premature",
  "closed",
]) {
  test(`broker ${response} response fails without a native-opener fallback`, async () => {
    const endpoint = await broker((request, socket) => {
      if (response === "closed") return socket.end();
      if (response === "malformed") return socket.end("invalid\n");
      if (response === "oversized") return socket.end(`${"x".repeat(65537)}\n`);
      socket.end(
        `${JSON.stringify({ id: response === "mismatched-id" ? "wrong" : request.id, ok: response !== "denied", result: { complete: response === "premature" } })}\n`,
      );
    });
    await expect(openImageWithBroker(endpoint, Buffer.alloc(32769))).rejects.toThrow();
  });
}

test("sandboxed image clicks reach the broker as decoded PNG data without creating an agent temporary file", async () => {
  setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
  let resolveOpened: (() => void) | undefined;
  const opened = new Promise<void>((resolve) => {
    resolveOpened = resolve;
  });
  const root = mkdtempSync(join(tmpdir(), "pi-click-test-"));
  roots.push(root);
  let nativeCalls = 0;
  const notifications: string[] = [];
  const endpoint = await broker((request, socket) => {
    const bytes = Buffer.from(request.params.data, "base64");
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(bytes.readUInt32BE(16)).toBe(1);
    expect(bytes.readUInt32BE(20)).toBe(1);
    socket.end(`${JSON.stringify({ id: request.id, ok: true, result: { complete: true } })}\n`);
    resolveOpened?.();
  });
  disposers.push(
    installImageOpenClickHandler({
      platform: "linux",
      tempDirectory: root,
      environment: { PI_NONO_MODE: "sandboxed", PI_DESKTOP_SOCKET: endpoint },
      notify: (message) => notifications.push(message),
      openFile: async () => {
        nativeCalls++;
      },
    }),
  );
  click();
  await opened;
  expect(nativeCalls).toBe(0);
  expect(readdirSync(root)).toEqual([]);
  expect(notifications).toEqual([]);
});

test("a missing sandbox broker reports an error instead of running xdg-open", async () => {
  setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
  let resolveNotice: ((message: string) => void) | undefined;
  const notice = new Promise<string>((resolve) => {
    resolveNotice = resolve;
  });
  let nativeCalls = 0;
  disposers.push(
    installImageOpenClickHandler({
      platform: "linux",
      environment: { NONO_CAP_FILE: "/fixture/cap.json" },
      notify: (message) => resolveNotice?.(message),
      openFile: async () => {
        nativeCalls++;
      },
    }),
  );
  click();
  expect(await notice).toContain("requires the desktop broker");
  expect(nativeCalls).toBe(0);
});

test("unsandboxed Linux retains its direct image opener", async () => {
  setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
  const root = mkdtempSync(join(tmpdir(), "pi-native-click-"));
  roots.push(root);
  let resolveOpened: ((path: string) => void) | undefined;
  const opened = new Promise<string>((resolve) => {
    resolveOpened = resolve;
  });
  disposers.push(
    installImageOpenClickHandler({
      platform: "linux",
      environment: {},
      tempDirectory: root,
      notify: () => {
        throw new Error("Unexpected error");
      },
      openFile: async (path) => {
        resolveOpened?.(path);
      },
    }),
  );
  click();
  expect(await opened).toStartWith(root);
});
