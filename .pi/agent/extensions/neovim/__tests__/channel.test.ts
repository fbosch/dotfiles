import { afterEach, expect, test } from "bun:test";
import { PiAskChannel } from "../channel";
import type { PromptAcknowledgement, PromptRequest } from "../prompt-protocol";
import { startEditor } from "./fixtures/editor";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
function handlers() {
  const seen: string[] = [];
  let disconnected = 0;
  let closed!: () => void;
  const disconnectedEvent = new Promise<void>((resolve) => {
    closed = resolve;
  });
  return {
    seen,
    disconnected: () => disconnected,
    disconnectedEvent,
    dispatch: (request: PromptRequest): PromptAcknowledgement => {
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
      closed();
    },
  };
}

test("NDJSON binds, delivers Unicode prompts, and acknowledges once", async () => {
  const editor = await startEditor();
  cleanup.push(editor.close);
  const observed = handlers();
  const channel = new PiAskChannel(editor.socket, editor.cwd, editor.launchId, observed);
  try {
    const binding = await channel.open("fixture-session");
    expect(binding.channelId).toBeGreaterThan(0);
    expect(binding.editorPid).toBeGreaterThan(0);
    expect(await editor.exited).toBe(0);
    expect(observed.seen).toEqual(["explain æøå"]);
    expect(editor.messages.at(-1)).toMatchObject({ acknowledged: { outcome: "accepted" } });
  } finally {
    channel.close();
    channel.close();
  }
  expect(observed.disconnected()).toBe(1);
});

for (const binding of [false, { version: 2 }, { channelId: 12, sessionId: "wrong-session" }]) {
  test("NDJSON rejects an incompatible session binding", async () => {
    const editor = await startEditor(true, false, binding);
    cleanup.push(editor.close);
    const observed = handlers();
    const channel = new PiAskChannel(editor.socket, editor.cwd, editor.launchId, observed);
    await expect(channel.open("fixture-session")).rejects.toThrow("binding");
    expect(channel.binding()).toBeUndefined();
    expect(observed.disconnected()).toBe(1);
  });
}

test("Pi Ask connection failure is reported", async () => {
  const observed = handlers();
  const channel = new PiAskChannel("/missing/nvim.sock", process.cwd(), "0".repeat(32), observed);
  await expect(channel.open("fixture-session")).rejects.toThrow();
  expect(observed.disconnected()).toBe(1);
});

test("editor exit retires the Pi Ask connection exactly once", async () => {
  const editor = await startEditor(true);
  cleanup.push(editor.close);
  const observed = handlers();
  const channel = new PiAskChannel(editor.socket, editor.cwd, editor.launchId, observed);
  await channel.open("fixture-session");
  await editor.close();
  await observed.disconnectedEvent;
  channel.close();
  expect(channel.binding()).toBeUndefined();
  expect(observed.disconnected()).toBe(1);
});

test("closing a pending Pi Ask bind cancels startup", async () => {
  const editor = await startEditor(true);
  cleanup.push(editor.close);
  const observed = handlers();
  const channel = new PiAskChannel(editor.socket, editor.cwd, editor.launchId, observed);
  const opening = channel.open("fixture-session");
  channel.close();
  await expect(opening).rejects.toThrow("closed");
  expect(observed.disconnected()).toBe(1);
});

test("a second Pi Ask client cannot replace a live terminal session", async () => {
  const editor = await startEditor(true);
  cleanup.push(editor.close);
  const first = new PiAskChannel(editor.socket, editor.cwd, editor.launchId, handlers());
  const next = new PiAskChannel(editor.socket, editor.cwd, editor.launchId, handlers());
  try {
    await first.open("fixture-session");
    await expect(next.open("another-session")).rejects.toThrow();
    expect(first.binding()?.sessionId).toBe("fixture-session");
  } finally {
    first.close();
    next.close();
  }
});

test("a disconnected NDJSON channel can be replaced without polling", async () => {
  const editor = await startEditor(true);
  cleanup.push(editor.close);
  const observed = handlers();
  const first = new PiAskChannel(editor.socket, editor.cwd, editor.launchId, observed);
  const next = new PiAskChannel(editor.socket, editor.cwd, editor.launchId, handlers());
  try {
    await first.open("fixture-session");
    await first.close();
    await observed.disconnectedEvent;
    expect((await next.open("replacement-session")).sessionId).toBe("replacement-session");
    expect(observed.disconnected()).toBe(1);
  } finally {
    first.close();
    next.close();
  }
});

test("stale socket events do not interrupt an immediately reopened channel", async () => {
  const editor = await startEditor(true);
  cleanup.push(editor.close);
  const channel = new PiAskChannel(editor.socket, editor.cwd, editor.launchId, handlers());
  const abandoned = channel.open("abandoned-session");
  const cancelled = abandoned.catch((error: unknown) => error);
  const closing = channel.close();
  try {
    const replacement = channel.open("replacement-session");
    expect(await cancelled).toMatchObject({ message: "Pi Ask channel closed" });
    expect((await replacement).sessionId).toBe("replacement-session");
    await closing;
    expect(channel.binding()?.sessionId).toBe("replacement-session");
  } finally {
    await channel.close();
  }
});
