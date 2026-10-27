import { afterEach, expect, test } from "bun:test";
import { once } from "node:events";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiAskChannel } from "../channel";
import type { PromptAcknowledgement } from "../prompt-protocol";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
const launchId = "0123456789abcdef0123456789abcdef";
const sessionId = "fixture-session";

async function fixture(reply: (socket: Socket, binding: object) => void) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "pi-ask-client-")));
  const socketPath = join(cwd, "broker.sock");
  const connections = new Set<Socket>();
  const server = createServer((socket) => {
    connections.add(socket);
    socket.once("close", () => connections.delete(socket));
    socket.once("data", () =>
      reply(socket, {
        channelId: 12,
        cwd,
        editorPid: 80,
        launchId,
        ownerId: "fixture-owner",
        sessionId,
        version: 1,
      }),
    );
  });
  server.listen(socketPath);
  await once(server, "listening");
  cleanup.push(async () => {
    for (const socket of connections) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(cwd, { recursive: true, force: true });
  });
  return { cwd, socketPath };
}

function handlers() {
  const seen: string[] = [];
  let disconnected = 0;
  return {
    seen,
    disconnected: () => disconnected,
    dispatch: (request: {
      requestId: string;
      launchId: string;
      sessionId: string;
      ownerId: string;
      text: string;
    }): PromptAcknowledgement => {
      seen.push(request.text);
      return {
        version: 1,
        requestId: request.requestId,
        launchId: request.launchId,
        sessionId: request.sessionId,
        ownerId: request.ownerId,
        outcome: "accepted",
        state: "idle",
      };
    },
    reject: (): PromptAcknowledgement => {
      throw new Error("unexpected rejected request");
    },
    disconnect: () => {
      disconnected++;
    },
  };
}

test("client binds a session, buffers fragmented frames and acknowledges a Unicode prompt", async () => {
  let received: unknown;
  let acknowledge!: () => void;
  const acknowledged = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  const { cwd, socketPath } = await fixture((socket, binding) => {
    socket.once("data", (data) => {
      received = JSON.parse(data.toString());
      acknowledge();
    });
    socket.write(`${JSON.stringify({ type: "bound", binding })}\n`);
    const frame = Buffer.from(
      `${JSON.stringify({ type: "prompt", request: { version: 1, requestId: `nvim:${launchId}:1`, sequence: 1, launchId, sessionId, ownerId: "fixture-owner", cwd, editorPid: 80, text: "første æøå", context: null, operation: "submit" } })}\n`,
    );
    const split = frame.indexOf(Buffer.from("æ")) + 1;
    socket.write(frame.subarray(0, split));
    setImmediate(() => socket.write(frame.subarray(split)));
  });
  const observed = handlers();
  const channel = new PiAskChannel(socketPath, cwd, launchId, observed);
  await channel.open(sessionId);
  await acknowledged;
  expect(observed.seen).toEqual(["første æøå"]);
  expect(received).toMatchObject({ type: "ack", payload: { outcome: "accepted", sessionId } });
  channel.close();
  channel.close();
  expect(observed.disconnected()).toBe(1);
});

for (const reply of [
  "not-json\n",
  `${"x".repeat(64 * 1024 + 1)}\n`,
  `${JSON.stringify({ type: "bound", binding: { channelId: 12, editorPid: 80, launchId: "wrong" } })}\n`,
]) {
  test("client refuses malformed or mismatched broker bindings", async () => {
    const { cwd, socketPath } = await fixture((socket) => {
      socket.write(reply);
    });
    const observed = handlers();
    const channel = new PiAskChannel(socketPath, cwd, launchId, observed);
    await expect(channel.open(sessionId)).rejects.toThrow();
    expect(channel.binding()).toBeUndefined();
    expect(observed.disconnected()).toBe(1);
  });
}

test("connection failure is reported without a raw Neovim RPC fallback", async () => {
  const observed = handlers();
  const channel = new PiAskChannel(
    "/missing/pi-ask-broker.sock",
    process.cwd(),
    launchId,
    observed,
  );
  await expect(channel.open(sessionId)).rejects.toThrow();
  expect(observed.disconnected()).toBe(1);
});
