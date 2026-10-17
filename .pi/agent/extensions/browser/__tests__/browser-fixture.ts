import type { JsonValue } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionToolContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { assertClassifierJson } from "../../../lib/classifier";
import type { BrowserBackend } from "../backends";

type Control = "email" | "submit" | "updates" | "learn" | "country";
export function browserFixture(backend: BrowserBackend) {
  const calls: { name: string; args: Record<string, unknown>; signal?: AbortSignal }[] = [];
  const actions: { action: string; value?: string }[] = [];
  const tools: ToolDefinition[] = [];
  const state = {
    url: "https://example.com/form",
    controls: ["email", "submit", "updates", "learn", "country"] as Control[],
    value: "",
    checked: false,
    nativeText: "",
    metadataInvalid: false,
    metadataOverrides: {} as Record<string, unknown>,
    failTool: "",
    failMessage: "Native tool denied by permission hook",
  };
  const uids =
    backend === "firefox"
      ? { email: "e0", submit: "e1", updates: "e2", learn: "e3", country: "e4" }
      : { email: "2_1", submit: "2_2", updates: "2_3", learn: "2_4", country: "2_5" };
  const labels = {
    email: "Email",
    submit: "Submit",
    updates: "Updates",
    learn: "Learn more",
    country: "Country",
  };
  const roles = {
    email: "textbox",
    submit: "button",
    updates: "checkbox",
    learn: "link",
    country: "combobox",
  };
  const tags = {
    email: "input",
    submit: "button",
    updates: "input",
    learn: "a",
    country: "select",
  };
  const snapshot = (cli = false) =>
    state.controls
      .map((control) => {
        if (cli) {
          const attributes = [`ref=e${Object.keys(uids).indexOf(control) + 1}`];
          if (control === "updates") attributes.push(`checked=${state.checked}`);
          return `- ${roles[control]} ${JSON.stringify(labels[control])} [${attributes.join(", ")}]`;
        }
        const role = backend === "firefox" ? tags[control] : roles[control];
        return `  uid=${uids[control]} ${role} ${JSON.stringify(labels[control])} interactive${control === "updates" && state.checked ? " checked" : ""}${control === "email" && state.value ? ` value=${JSON.stringify(state.value)}` : ""}${control === "learn" ? ' url="https://example.com/docs"' : ""}`;
      })
      .join("\n") +
    "\n" +
    state.nativeText;
  const effect = (action: string, args: Record<string, unknown>) => {
    const value =
      typeof args.value === "string"
        ? args.value
        : typeof args.text === "string"
          ? args.text
          : undefined;
    actions.push({ action, ...(value === undefined ? {} : { value }) });
    if (action.startsWith("fill")) state.value = value ?? "";
    if (args.uid === uids.updates) state.checked = !state.checked;
    if ((action === "click" || action === "click_by_uid") && args.uid === uids.submit) {
      state.url = "https://example.com/done";
      state.controls = [];
    }
  };
  const record = (value: JsonValue): value is Record<string, JsonValue> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  const executeTool: ExtensionToolContext["executeTool"] = async (name, input, options) => {
    assertClassifierJson(input);
    if (!record(input)) throw new Error("Fixture expected object tool arguments");
    const args = input;
    calls.push({
      name,
      args,
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    });
    const tool = name.replace(/^mcp__\w+_devtools__/u, "");
    const json = (value: unknown) =>
      `Script returned:\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
    let text = "Native action completed";
    if (tool === "new_page") {
      state.url = String(args.url);
      text =
        backend === "chrome"
          ? `3: ${state.url} [selected]`
          : `Navigated new page [3] to ${state.url}`;
    } else if (tool === "take_snapshot") {
      text = snapshot();
    } else if (tool === "evaluate_script") {
      const fn = String(args.function);
      if (fn === "() => location.href") text = json(state.url);
      else if (fn.includes("els.map"))
        text = state.metadataInvalid
          ? json([])
          : json(
              state.controls.map((control) => ({
                tag: tags[control],
                role: null,
                type: control === "updates" ? "checkbox" : "text",
                checked: state.checked,
                disabled: false,
                ...state.metadataOverrides,
              })),
            );
      else if (fn.includes("aria-checked")) text = json(state.checked);
      else text = json(true);
    } else if (tool !== "select_page" && tool !== state.failTool) {
      effect(tool, args);
    }
    return {
      toolCall: { type: "toolCall", id: "native-child", name, arguments: args },
      result: {
        content: [{ type: "text", text: tool === state.failTool ? state.failMessage : text }],
        details: {},
      },
      isError: tool === state.failTool,
    };
  };
  const pi = {
    registerTool: (tool: ToolDefinition) => tools.push(tool),
    on: () => {},
    exec: async (command: string, args: string[], options?: { signal?: AbortSignal }) => {
      calls.push({
        name: command,
        args: { argv: args },
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      });
      const action = args[4] ?? "";
      const target = args[5] ?? "";
      if (action === state.failTool)
        return { stdout: state.failMessage, stderr: "", code: 1, killed: false };
      let stdout = "CLI action completed";
      if (action === "snapshot")
        stdout = snapshot(true) + (state.value ? `\nvalue="${state.value}"` : "");
      else if (action === "get") stdout = state.url;
      else if (action === "open") state.url = target;
      else if (action !== "wait") {
        const control = Object.keys(uids)[Number(target.replace("@e", "")) - 1] as
          | Control
          | undefined;
        effect(action, {
          ...(control === undefined ? {} : { uid: uids[control] }),
          ...(args[6] === undefined ? {} : { value: args[6] }),
        });
      }
      return { stdout, stderr: "", code: 0, killed: false };
    },
  } as unknown as ExtensionAPI;
  const ctx = {
    sessionManager: { getSessionId: () => "test/session" },
    executeTool,
  } as unknown as ExtensionToolContext;
  const getTool = (name: string): ToolDefinition => {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`Tool not registered: ${name}`);
    return tool;
  };
  return { pi, ctx, calls, actions, state, uids, getTool };
}
