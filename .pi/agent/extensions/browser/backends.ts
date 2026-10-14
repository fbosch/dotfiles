import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type ExtensionAPI,
  type ExtensionToolContext,
  truncateHead,
} from "@earendil-works/pi-coding-agent";

export type BrowserBackend = "agent-browser" | "chrome" | "firefox";
export interface BrowserTarget {
  backend?: BrowserBackend;
  pageId?: number;
}
export interface BrowserInteraction {
  action: "click" | "fill" | "type" | "press" | "check" | "uncheck" | "hover" | "select";
  target: string;
  value?: string;
}
export interface SnapshotOptions {
  interactiveOnly?: boolean;
  includeUrls?: boolean;
  selector?: string;
}
export interface BrowserDriver {
  open(url: string): Promise<string>;
  snapshot(options?: SnapshotOptions): Promise<string>;
  act(input: BrowserInteraction): Promise<string>;
  url(): Promise<string>;
  settle(action: BrowserInteraction["action"], retry?: boolean): Promise<void>;
}

const COMMAND_TIMEOUT_MS = 30_000;
const MAX_MCP_CONTROLS = 200;
const MCP_NODE = /^\s*uid=(\S+)\s+([\w-]+)(?:\s+("(?:\\.|[^"\\])*"))?(.*)$/u;
const ROLES = new Set(["button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox"]);

export function browserArgs(sessionId: string, command: readonly string[]): string[] {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/gu, "-").slice(0, 48);
  return ["--engine", "lightpanda", "--session", `pi-${safe || "browser"}`, ...command];
}

export function boundedOutput(output: string): string {
  const result = truncateHead(output, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  return result.truncated ? `${result.content}\n\n[browser output truncated]` : result.content;
}

function cliDriver(pi: ExtensionAPI, sessionId: string, signal?: AbortSignal): BrowserDriver {
  const run = async (command: string[]): Promise<string> => {
    const result = await pi.exec("agent-browser", browserArgs(sessionId, command), {
      ...(signal === undefined ? {} : { signal }),
      timeout: COMMAND_TIMEOUT_MS,
    });
    const output = [result.stdout.trimEnd(), result.stderr.trimEnd()].filter(Boolean).join("\n");
    if (result.code !== 0 || result.killed) throw new Error(output || "agent-browser failed");
    return boundedOutput(output);
  };
  return {
    open: (url) => run(["open", url]),
    snapshot: (options = {}) => {
      const command = ["snapshot"];
      if (options.interactiveOnly !== false) command.push("-i");
      if (options.includeUrls === true) command.push("-u");
      if (options.selector !== undefined) command.push("-s", options.selector);
      return run(command);
    },
    act: ({ action, target, value }) =>
      run([action, target, ...(value === undefined ? [] : [value])]),
    url: async () => (await run(["get", "url"])).trim(),
    settle: async (action, retry = false) => {
      if (action !== "click") return;
      // The CLI click resolves before Lightpanda announces the navigation it initiated.
      await run(["wait", retry ? "1000" : "150"]);
      await run(["wait", "--load", "domcontentloaded"]);
    },
  };
}

interface NativeControl {
  uid: string;
  role: string;
  label: string;
  checked?: boolean;
  disabled?: boolean;
  url?: string;
}
interface McpPage {
  refs: Map<string, NativeControl>;
  snapshotUrl?: string;
}
interface McpSession {
  pageId?: number;
  nextRef(): number;
  pages: Map<number, McpPage>;
}

function textResult(result: Awaited<ReturnType<ExtensionToolContext["executeTool"]>>): string {
  return result.result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

type ScriptValue = string | boolean | Record<string, unknown> | unknown[];
function scriptResult(text: string): ScriptValue {
  const json = /```json\s*\n([\s\S]*?)\n```/u.exec(text)?.[1];
  if (json === undefined) throw new Error("Browser MCP did not return a JSON script result");
  try {
    const value: unknown = JSON.parse(json);
    if (
      typeof value === "string" ||
      typeof value === "boolean" ||
      Array.isArray(value) ||
      record(value)
    )
      return value;
  } catch {
    throw new Error("Browser MCP returned malformed JSON");
  }
  throw new Error("Browser MCP returned an unsupported script result");
}

function snapshotLabel(quoted: string | undefined): string {
  if (quoted === undefined) return "";
  try {
    const value: unknown = JSON.parse(quoted);
    if (typeof value === "string") return value;
  } catch {
    throw new Error("Browser MCP returned a malformed snapshot label");
  }
  throw new Error("Browser MCP returned a non-string snapshot label");
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nativeNodes(snapshot: string): NativeControl[] {
  const nodes: NativeControl[] = [];
  for (const line of snapshot.split("\n")) {
    const match = MCP_NODE.exec(line);
    if (!match?.[1] || !match[2]) continue;
    const role = match[2];
    const attributes = match[4] ?? "";
    if (!ROLES.has(role) && !/\binteractive\b/u.test(attributes)) continue;
    nodes.push({
      uid: match[1],
      role,
      label: snapshotLabel(match[3]),
      checked: /(?:^|\s)checked(?:=true)?(?:\s|$)/u.test(attributes),
      disabled: /(?:^|\s)disabled(?:=true)?(?:\s|$)/u.test(attributes),
      ...(/\b(?:url|href)="([^"]*)"/u.exec(attributes)?.[1]
        ? { url: /\b(?:url|href)="([^"]*)"/u.exec(attributes)?.[1] ?? "" }
        : {}),
    });
    if (nodes.length === MAX_MCP_CONTROLS) break;
  }
  return nodes;
}

// Firefox's DOM snapshot labels inputs by tag, so read their actual types and state before proposing actions.
const FIREFOX_METADATA = `(...els) => els.map(el => ({
  tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), type: el.getAttribute('type'),
  checked: el.checked ?? el.getAttribute('aria-checked') === 'true',
  disabled: el.matches(':disabled') || el.readOnly === true || el.getAttribute('aria-disabled') === 'true'
}))`;

function validFirefoxMetadata(value: unknown): value is Record<string, unknown> {
  return (
    record(value) &&
    typeof value.tag === "string" &&
    (value.role === null || typeof value.role === "string") &&
    (value.type === null || typeof value.type === "string") &&
    typeof value.checked === "boolean" &&
    typeof value.disabled === "boolean"
  );
}

function firefoxRole(metadata: Record<string, unknown>): string | undefined {
  if (typeof metadata.role === "string" && ROLES.has(metadata.role)) return metadata.role;
  switch (metadata.tag) {
    case "a":
      return "link";
    case "button":
      return "button";
    case "textarea":
      return "textbox";
    case "select":
      return "combobox";
    case "input":
      if (metadata.type === "checkbox" || metadata.type === "radio") return metadata.type;
      if (metadata.type === "submit" || metadata.type === "button" || metadata.type === "reset")
        return "button";
      if (metadata.type === "hidden" || metadata.type === "file") return undefined;
      return metadata.type === "search" ? "searchbox" : "textbox";
    default:
      return undefined;
  }
}

function mcpDriver(
  ctx: ExtensionToolContext,
  backend: "chrome" | "firefox",
  target: BrowserTarget,
  session: McpSession,
  signal?: AbortSignal,
): BrowserDriver {
  const prefix = `mcp__${backend}_devtools__`;
  let pageId = target.pageId ?? session.pageId;
  const call = async (tool: string, args: Record<string, unknown>): Promise<string> => {
    const result = await ctx.executeTool(
      `${prefix}${tool}`,
      args,
      signal === undefined ? {} : { signal },
    );
    const text = textResult(result);
    if (result.isError) throw new Error(`${backend} ${tool}: ${text || "MCP call failed"}`);
    return text;
  };
  const page = (): McpPage => {
    if (pageId === undefined)
      throw new Error(`Open a ${backend} page with browser_open or supply pageId`);
    let state = session.pages.get(pageId);
    if (!state) {
      state = { refs: new Map() };
      session.pages.set(pageId, state);
    }
    return state;
  };
  const prepare = async (): Promise<void> => {
    page();
    // Firefox tools act on a shared selected tab; select the bound page before each operation.
    if (backend === "firefox") await call("select_page", { pageIdx: pageId });
  };
  const evaluate = async (fn: string, uids: string[] = []): Promise<ScriptValue> =>
    scriptResult(
      await call("evaluate_script", {
        function: fn,
        ...(backend === "chrome"
          ? { pageId, args: uids, waitForStableDom: false }
          : { args: uids.map((uid) => ({ uid })) }),
      }),
    );
  const url = async (): Promise<string> => {
    const value = await evaluate("() => location.href");
    if (typeof value !== "string") throw new Error(`${backend} MCP returned an invalid page URL`);
    return value;
  };
  return {
    open: async (address) => {
      const result = await call("new_page", { url: address });
      const id =
        backend === "chrome"
          ? /^\s*(\d+):.*\[selected\]\s*$/mu.exec(result)?.[1]
          : /new page \[(\d+)\]/u.exec(result)?.[1];
      if (id === undefined) throw new Error(`${backend} MCP did not identify the opened page`);
      pageId = Number(id);
      session.pageId = pageId;
      page().refs.clear();
      delete page().snapshotUrl;
      return `${backend} pageId=${pageId}\n${result}`;
    },
    snapshot: async (options = {}) => {
      if (backend === "chrome" && options.selector !== undefined) {
        throw new Error("Chrome MCP snapshots do not support selector scoping");
      }
      await prepare();
      const state = page();
      state.refs.clear();
      const address = await url();
      const native = await call(
        "take_snapshot",
        backend === "chrome"
          ? { pageId }
          : {
              maxLines: DEFAULT_MAX_LINES,
              includeAttributes: true,
              ...(options.selector === undefined ? {} : { selector: options.selector }),
            },
      );
      let controls = nativeNodes(native);
      if (backend === "firefox" && controls.length) {
        const metadata = await evaluate(
          FIREFOX_METADATA,
          controls.map(({ uid }) => uid),
        );
        if (!Array.isArray(metadata) || metadata.length !== controls.length) {
          throw new Error("Firefox MCP returned invalid control metadata");
        }
        controls = controls.flatMap((control, index) => {
          const value: unknown = metadata[index];
          if (!validFirefoxMetadata(value))
            throw new Error("Firefox MCP returned invalid control metadata");
          const role = firefoxRole(value);
          return role === undefined
            ? []
            : [
                {
                  ...control,
                  role,
                  checked: value.checked === true,
                  disabled: value.disabled === true,
                },
              ];
        });
      }
      const lines: string[] = [];
      for (const control of controls) {
        if (control.disabled) continue;
        // Never recycle aliases: an action from an older snapshot must not hit a different node.
        const ref = `e${session.nextRef()}`;
        state.refs.set(`@${ref}`, control);
        const attributes = [`ref=${ref}`];
        if (control.role === "checkbox" || control.role === "radio")
          attributes.push(`checked=${control.checked === true}`);
        if (options.includeUrls && control.url)
          attributes.push(`url=${JSON.stringify(control.url)}`);
        lines.push(`- ${control.role} ${JSON.stringify(control.label)} [${attributes.join(", ")}]`);
      }
      state.snapshotUrl = address;
      // Keep page-controlled text from masquerading as canonical candidate lines.
      const context =
        options.interactiveOnly === false
          ? `\n\nNative snapshot:\n${native
              .split("\n")
              .map((line) => `| ${line}`)
              .join("\n")}`
          : "";
      return boundedOutput(
        `${backend} pageId=${pageId}\nURL: ${address}\n${lines.join("\n")}${context}`,
      );
    },
    act: async ({ action, target: ref, value }) => {
      if ((action === "fill" || action === "type" || action === "select") && value === undefined) {
        throw new Error(`${action} requires value`);
      }
      await prepare();
      const state = page();
      if (state.snapshotUrl !== undefined && (await url()) !== state.snapshotUrl) {
        state.refs.clear();
        throw new Error("Browser page changed; take a fresh browser_snapshot before acting");
      }
      const pageArgs = backend === "chrome" ? { pageId } : {};
      if (action === "press") {
        state.refs.clear();
        return call("press_key", { ...pageArgs, key: ref });
      }
      const control = state.refs.get(ref);
      if (!control)
        throw new Error("Unknown or stale browser ref; use the latest browser_snapshot refs");
      // Chrome typing needs a focus click; do not turn a mistaken text target into a button click.
      if (
        (action === "fill" || action === "type") &&
        !["textbox", "searchbox", "combobox"].includes(control.role)
      ) {
        throw new Error("Fill and type require a text field or combobox");
      }
      if (action === "select" && control.role !== "combobox") {
        throw new Error("Select requires a combobox");
      }
      if ((action === "check" || action === "uncheck") && control.role !== "checkbox") {
        throw new Error("Check and uncheck require a checkbox");
      }
      // A click may succeed even if its response fails; never leave refs available for an automatic replay.
      if (action === "click") state.refs.clear();
      const uid = control.uid;
      let result: string;
      if (action === "click" || action === "hover") {
        result = await call(backend === "chrome" ? action : `${action}_by_uid`, {
          ...pageArgs,
          uid,
        });
      } else if (action === "type") {
        if (backend === "chrome") await call("click", { pageId, uid });
        result = await call("type_text", {
          ...pageArgs,
          ...(backend === "firefox" ? { uid } : {}),
          text: value,
        });
      } else if (backend === "chrome") {
        result = await call("fill", {
          pageId,
          uid,
          value: action === "check" ? "true" : action === "uncheck" ? "false" : value,
        });
      } else if (action === "fill") {
        result = await call("fill_by_uid", { uid, value });
      } else if (action === "select") {
        // Firefox has no native select tool; constrain the script to one UID and a literal caller-supplied value.
        await evaluate(
          `(el) => {
          if (!(el instanceof HTMLSelectElement)) throw new Error('Target is not a select');
          const value = ${JSON.stringify(value)};
          const option = Array.from(el.options).find(o => o.value === value || o.label === value);
          if (!option || option.disabled) throw new Error('Option not found or disabled');
          el.value = option.value;
          el.dispatchEvent(new Event('input', {bubbles:true}));
          el.dispatchEvent(new Event('change', {bubbles:true}));
          return true;
        }`,
          [uid],
        );
        result = "Selected supplied value";
      } else {
        if (control.role !== "checkbox") throw new Error("Check and uncheck require a checkbox");
        const checked = await evaluate(
          "(el) => el.checked ?? el.getAttribute('aria-checked') === 'true'",
          [uid],
        );
        if (typeof checked !== "boolean") throw new Error("Invalid checkbox state");
        result =
          checked === (action === "check")
            ? "Checkbox already in requested state"
            : await call("click_by_uid", { uid });
      }
      return boundedOutput(result);
    },
    url: async () => {
      await prepare();
      return url();
    },
    settle: async () => {
      // Native MCP interactions and snapshots own browser readiness; do not replay a possibly completed action.
    },
  };
}

export function createBrowserBackends(): (
  pi: ExtensionAPI,
  ctx: ExtensionToolContext,
  target: BrowserTarget,
  signal?: AbortSignal,
) => BrowserDriver {
  const sessions = new Map<string, McpSession>();
  let nextRef = 0;
  return (pi, ctx, target, signal) => {
    const backend = target.backend ?? "agent-browser";
    if (backend === "agent-browser") {
      if (target.pageId !== undefined)
        throw new Error("pageId is only supported by MCP browser backends");
      return cliDriver(pi, ctx.sessionManager.getSessionId(), signal);
    }
    const key = `${ctx.sessionManager.getSessionId()}:${backend}`;
    let session = sessions.get(key);
    if (!session) {
      session = { nextRef: () => ++nextRef, pages: new Map() };
      sessions.set(key, session);
    }
    return mcpDriver(ctx, backend, target, session, signal);
  };
}
