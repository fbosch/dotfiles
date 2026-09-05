import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  createPromptReplayState,
  MAX_PROMPT_BYTES,
  PROMPT_NOTIFICATION,
  type PromptBinding,
  type PromptReplayState,
  type PromptRequest,
  PromptRequestDispatcher,
  parsePromptBinding,
  parsePromptNotification,
} from "../prompt-protocol";

const launchId = "0123456789abcdef0123456789abcdef";
const sessionId = "pi-session-one";
const ownerId = "herdr-w1-p1";

function request(overrides: Partial<PromptRequest> = {}): PromptRequest {
  const sequence = overrides.sequence ?? 1;
  const requestLaunchId = overrides.launchId ?? launchId;
  return {
    context: null,
    cwd: "/project",
    editorPid: 80,
    launchId: requestLaunchId,
    operation: "submit",
    ownerId,
    requestId: `nvim:${requestLaunchId}:${sequence}`,
    sequence,
    sessionId,
    text: "literal prompt",
    version: 1,
    ...overrides,
  };
}

function binding(overrides: Partial<PromptBinding> = {}): PromptBinding {
  return {
    channelId: 12,
    cwd: "/project",
    editorPid: 80,
    launchId,
    ownerId,
    sessionId,
    version: 1,
    ...overrides,
  };
}

function dispatcherFixture(
  options: {
    readonly blockingPromptActive?: boolean;
    readonly binding?: PromptBinding;
    readonly editorText?: string;
    readonly hasContext?: boolean;
    readonly idle?: boolean;
    readonly onSubmit?: () => void;
    readonly replayState?: PromptReplayState;
  } = {},
) {
  let editorText = options.editorText ?? "";
  const sent: string[] = [];
  const writes: string[] = [];
  const context = {
    cwd: "/project",
    hasUI: true,
    isIdle: () => options.idle ?? true,
    mode: "tui",
    sessionManager: { getSessionId: () => sessionId },
    ui: {
      getEditorText: () => editorText,
      setEditorText: (text: string) => {
        editorText = text;
        writes.push(text);
      },
    },
  } as unknown as ExtensionContext;
  const pi = {
    sendUserMessage: (text: string) => {
      sent.push(text);
      options.onSubmit?.();
    },
  } as unknown as ExtensionAPI;
  const dispatcher = new PromptRequestDispatcher(pi, {
    binding: () => options.binding ?? binding(),
    blockingPromptActive: () => options.blockingPromptActive ?? false,
    context: () => (options.hasContext === false ? undefined : context),
    replayState: options.replayState ?? createPromptReplayState(),
  });
  return { dispatcher, editorText: () => editorText, sent, writes };
}

describe("Pi prompt notification contract", () => {
  test("parses one closed bounded request", () => {
    expect(parsePromptNotification(PROMPT_NOTIFICATION, [request()])).toEqual({
      ok: true,
      value: request(),
    });
  });

  test("ignores unrelated notifications", () => {
    expect(parsePromptNotification("pi:focus", [request()])).toBeUndefined();
  });

  test("rejects extra fields and malformed request identity", () => {
    const malformed = parsePromptNotification(PROMPT_NOTIFICATION, [
      { ...request(), forged: true },
    ]);
    const changed = parsePromptNotification(PROMPT_NOTIFICATION, [
      { ...request(), forged: "changed" },
    ]);
    expect(malformed).toMatchObject({
      error: "PI_INVALID_REQUEST",
      ok: false,
    });
    expect(malformed?.ok === false ? malformed.fingerprint : undefined).toHaveLength(64);
    expect(changed?.ok === false ? changed.fingerprint : undefined).not.toBe(
      malformed?.ok === false ? malformed.fingerprint : undefined,
    );
    expect(
      parsePromptNotification(PROMPT_NOTIFICATION, [
        { ...request(), requestId: `nvim:${launchId}:2` },
      ]),
    ).toEqual({ error: "PI_INVALID_REQUEST", ok: false });
  });

  test("uses UTF-8 byte limits without truncation", () => {
    const exact = "ø".repeat(MAX_PROMPT_BYTES / 2);
    expect(parsePromptNotification(PROMPT_NOTIFICATION, [request({ text: exact })])?.ok).toBe(true);
    expect(
      parsePromptNotification(PROMPT_NOTIFICATION, [request({ text: `${exact}ø` })]),
    ).toMatchObject({
      error: "PI_PROMPT_TOO_LARGE",
      ok: false,
    });
    expect(
      parsePromptNotification(PROMPT_NOTIFICATION, [
        request({ text: String.fromCharCode(0xd800) }),
      ]),
    ).toMatchObject({
      error: "PI_INVALID_UTF8",
      ok: false,
    });
  });

  test.each(["\ud800", "prefix\udbff", "\udc00", "\ud800x", "\ud800\ud800"])(
    "rejects unpaired surrogates in prompt text: %j",
    (text) => {
      expect(parsePromptNotification(PROMPT_NOTIFICATION, [request({ text })])).toMatchObject({
        error: "PI_INVALID_UTF8",
        ok: false,
      });
    },
  );

  test("preserves valid surrogate pairs", () => {
    const text = "prefix\ud83d\ude00suffix";
    expect(parsePromptNotification(PROMPT_NOTIFICATION, [request({ text })])).toEqual({
      ok: true,
      value: request({ text }),
    });
  });

  test("rejects empty and NUL-containing submissions", () => {
    for (const text of [" \n\t", "\u0085", "\u00a0\u2003"]) {
      expect(parsePromptNotification(PROMPT_NOTIFICATION, [request({ text })])).toMatchObject({
        error: "PI_PROMPT_EMPTY",
        ok: false,
      });
    }
    expect(
      parsePromptNotification(PROMPT_NOTIFICATION, [request({ text: "no\0pe" })]),
    ).toMatchObject({
      error: "PI_INVALID_REQUEST",
      ok: false,
    });
  });

  test("parses a binding only for the exact editor identity", () => {
    const value = binding();
    expect(
      parsePromptBinding(value, {
        channelId: 12,
        cwd: "/project",
        editorPid: 80,
        launchId,
        sessionId,
      }),
    ).toEqual(value);
    expect(
      parsePromptBinding(
        { ...value, channelId: 13 },
        {
          channelId: 12,
          cwd: "/project",
          editorPid: 80,
          launchId,
          sessionId,
        },
      ),
    ).toBeUndefined();
  });
});

describe("Pi prompt request dispatch", () => {
  test("dispatches one idle literal submission", () => {
    const target = dispatcherFixture();

    expect(target.dispatcher.dispatch(request())).toMatchObject({
      outcome: "accepted",
      state: "idle",
    });
    expect(target.sent).toEqual(["literal prompt"]);
  });

  test.each([
    { blockingPromptActive: true, code: "PI_BUSY", state: "blocked" },
    { idle: false, code: "PI_BUSY", state: "streaming" },
    { hasContext: false, code: "PI_SESSION_NOT_READY", state: "starting" },
  ])("rejects unavailable Pi state", (options) => {
    const target = dispatcherFixture(options);

    expect(target.dispatcher.dispatch(request())).toMatchObject({
      code: options.code,
      outcome: "rejected",
      state: options.state,
    });
    expect(target.sent).toEqual([]);
  });

  test.each([
    {
      binding: binding({ launchId: "abcdef0123456789abcdef0123456789" }),
      code: "PI_LAUNCH_MISMATCH",
    },
    { binding: binding({ sessionId: "other-session" }), code: "PI_SESSION_MISMATCH" },
    { binding: binding({ cwd: "/sibling" }), code: "PI_WORKTREE_MISMATCH" },
  ])("rejects mismatched binding identity", (options) => {
    const target = dispatcherFixture({ binding: options.binding });

    expect(target.dispatcher.dispatch(request())).toMatchObject({
      code: options.code,
      outcome: "rejected",
    });
    expect(target.sent).toEqual([]);
  });

  test("appends exact editor text without submission", () => {
    const target = dispatcherFixture({ editorText: "existing" });

    expect(
      target.dispatcher.dispatch(request({ operation: "append", text: "\ncontext" })),
    ).toMatchObject({ outcome: "accepted" });
    expect(target.editorText()).toBe("existing\ncontext");
    expect(target.writes).toEqual(["existing\ncontext"]);
    expect(target.sent).toEqual([]);
  });

  test("rejects an in-flight duplicate before a second side effect", () => {
    let nested: ReturnType<PromptRequestDispatcher["dispatch"]> | undefined;
    let dispatcher: PromptRequestDispatcher;
    const target = dispatcherFixture({
      onSubmit: () => {
        nested = dispatcher.dispatch(request());
      },
    });
    dispatcher = target.dispatcher;

    expect(dispatcher.dispatch(request())).toMatchObject({ outcome: "accepted" });
    expect(nested).toMatchObject({ code: "PI_REQUEST_PENDING", outcome: "duplicate" });
    expect(target.sent).toEqual(["literal prompt"]);
  });

  test("replays completion and rejects changed-content ID reuse", () => {
    const target = dispatcherFixture();
    target.dispatcher.dispatch(request());

    expect(target.dispatcher.dispatch(request())).toMatchObject({ outcome: "duplicate" });
    expect(target.dispatcher.dispatch(request({ text: "changed" }))).toMatchObject({
      code: "PI_REQUEST_ID_REUSED",
      outcome: "rejected",
    });
    expect(target.sent).toEqual(["literal prompt"]);
  });

  test("acknowledges malformed requests and advances their sequence", () => {
    const target = dispatcherFixture();

    expect(target.dispatcher.rejectMalformed(request(), "PI_INVALID_UTF8", "first")).toMatchObject({
      code: "PI_INVALID_UTF8",
      outcome: "rejected",
    });
    expect(
      target.dispatcher.rejectMalformed(request(), "PI_INVALID_UTF8", "changed"),
    ).toMatchObject({
      code: "PI_REQUEST_ID_REUSED",
      outcome: "rejected",
    });
    expect(target.sent).toEqual([]);
    expect(
      target.dispatcher.dispatch(request({ requestId: `nvim:${launchId}:2`, sequence: 2 })),
    ).toMatchObject({ outcome: "accepted" });
    expect(target.sent).toEqual(["literal prompt"]);
  });

  test("preserves replay protection across dispatcher replacement", () => {
    const replayState = createPromptReplayState();
    const first = dispatcherFixture({ replayState });
    first.dispatcher.dispatch(request());

    const replacement = dispatcherFixture({ replayState });
    expect(replacement.dispatcher.dispatch(request())).toMatchObject({ outcome: "duplicate" });
    expect(replacement.sent).toEqual([]);
    expect(
      replacement.dispatcher.dispatch(request({ requestId: `nvim:${launchId}:2`, sequence: 2 })),
    ).toMatchObject({ outcome: "accepted" });
    expect(replacement.sent).toEqual(["literal prompt"]);
  });

  test("rejects sequence gaps and stale unknown requests", () => {
    const target = dispatcherFixture();

    expect(
      target.dispatcher.dispatch(request({ requestId: `nvim:${launchId}:2`, sequence: 2 })),
    ).toMatchObject({
      code: "PI_REQUEST_OUT_OF_ORDER",
    });
    target.dispatcher.dispatch(request());
    expect(
      target.dispatcher.dispatch(request({ requestId: `nvim:${launchId}:0`, sequence: 0 })),
    ).toMatchObject({ code: "PI_STALE_REQUEST" });
  });
});
