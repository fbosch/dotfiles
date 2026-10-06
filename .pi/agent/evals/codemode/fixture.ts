import { appendFileSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import { createCodemodeExtension, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export function instrumentScript(source: string): string {
  const options = /^\/\/ @options:[^\n]*\n/u.exec(source)?.[0] ?? "";
  const body = source.slice(options.length);
  // Measure executed and awaited batches inside the isolated VM, not a textual mention.
  return `${options}const __caliperOriginal = Promise.allSettled;
const __caliperCompleted = [];
Promise.allSettled = function(values) {
  const items = Array.from(values);
  return __caliperOriginal.call(this, items).then(results => {
    __caliperCompleted.push(items.length);
    return results;
  });
};
try {\n${body}\n} finally { store("__caliper_batches", __caliperCompleted); }`;
}

function recordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default function codemodeFixture(pi: ExtensionAPI): void {
  const trace = process.env.CODEMODE_TRACE;
  const work = process.env.CODEMODE_WORK;
  const scenario = process.env.CODEMODE_CASE;
  if (!trace || !work || !scenario) throw new Error("Use the isolated codemode launcher");
  const rulePath = process.env.CODEMODE_RULE;
  const rule = rulePath ? readFileSync(rulePath, "utf8").trim() : undefined;
  const root = realpathSync(work);
  const record = (kind: string, data: Record<string, unknown> = {}) =>
    appendFileSync(trace, `${JSON.stringify({ kind, ...data })}\n`, { mode: 0o600 });
  let turns = 0;
  let scriptId: string | undefined;
  const allowed = new Set(["read", "write", "check_one", "check_two", "codemode"]);
  const expected = scenario === "rejected" ? 3 : 2;
  const arrivals = new Set<string>();
  const peers = Promise.withResolvers<void>();
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const cohort =
    scenario === "large" ? new Set(["large.ts", "small.ts"]) : new Set(["a.ts", "b.ts", "c.ts"]);
  const allowedFiles = new Set([
    "a.ts",
    "b.ts",
    "c.ts",
    "large.ts",
    "small.ts",
    "manifest.json",
    "config.json",
  ]);
  function fixturePath(path: string): string {
    const absolute = resolve(root, path);
    if (
      !absolute.startsWith(root + sep) ||
      !allowedFiles.has(basename(absolute)) ||
      realpathSync(absolute) !== absolute
    )
      throw new Error("File is outside the fixture allowlist");
    return absolute;
  }
  async function rendezvous(key: string): Promise<void> {
    arrivals.add(key);
    if (!watchdog) watchdog = setTimeout(() => peers.resolve(), 500);
    if (arrivals.size >= expected) {
      clearTimeout(watchdog);
      peers.resolve();
    }
    // The watchdog lets a sequential attempt finish and fail the ordering assertion.
    await peers.promise;
  }
  pi.registerTool({
    name: "read",
    label: "Read fixture file",
    description:
      "Read a fixture file. Returns {ok:true,path,text,lines:[{anchor,text}]}; text renders the same lines with anchors. Use lines for structured extraction or text for rendered rows.",
    parameters: Type.Object({ path: Type.String() }),
    outputSchema: Type.Unknown(),
    async execute(id, params, signal) {
      const path = fixturePath(params.path);
      const name = basename(path);
      record("start", { id, tool: "read", path: name, scriptId });
      try {
        if (cohort.has(name) && scenario !== "single" && scenario !== "mutations")
          await rendezvous(name);
        signal?.throwIfAborted();
        if (scenario === "rejected" && name === "b.ts") throw new Error("Permission denied");
        const lines = readFileSync(path, "utf8")
          .trimEnd()
          .split("\n")
          .map((text, index) => ({
            anchor: index === 0 ? "aaaa" : "aaab",
            text,
          }));
        const data = {
          ok: true,
          path: name,
          text: lines.map((line) => `${line.anchor}│${line.text}`).join("\n"),
          lines,
        };
        record("end", { id, tool: "read", path: name, success: true });
        return {
          content: [{ type: "text", text: data.text }],
          details: undefined,
          structuredContent: data,
        };
      } catch (error) {
        record("end", { id, tool: "read", path: name, success: false, error: String(error) });
        throw error;
      }
    },
  });
  pi.registerTool({
    name: "write",
    label: "Write fixture file",
    description:
      "Write the complete content of config.json, only when the user requests a mutation.",
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
    async execute(id, params) {
      const path = fixturePath(params.path);
      if (scenario !== "mutations" || basename(path) !== "config.json")
        throw new Error("Mutation not authorized in this case");
      record("start", {
        id,
        tool: "write",
        path: "config.json",
        content: params.content,
        scriptId,
      });
      try {
        JSON.parse(params.content);
        writeFileSync(path, params.content);
        record("end", { id, tool: "write", path: "config.json", success: true });
        return { content: [{ type: "text", text: "Written" }], details: undefined };
      } catch (error) {
        record("end", {
          id,
          tool: "write",
          path: "config.json",
          success: false,
          error: String(error),
        });
        throw error;
      }
    },
  });
  for (const name of ["check_one", "check_two"]) {
    pi.registerTool({
      name,
      label: name,
      description:
        "Run a supplied check. Resolves to {ok:boolean,message?:string,error?:string}; ok:false is a tool-level failure even though the promise fulfills.",
      parameters: Type.Object({}),
      outputSchema: Type.Unknown(),
      async execute(id, _params, signal) {
        record("start", { id, tool: name, scriptId });
        await rendezvous(name);
        signal?.throwIfAborted();
        const data: Record<string, string | boolean> =
          name === "check_one"
            ? { ok: true, message: "Passed" }
            : { ok: false, error: "Invalid configuration" };
        record("end", { id, tool: name, success: true });
        return {
          content: [{ type: "text", text: JSON.stringify(data) }],
          details: undefined,
          structuredContent: data,
        };
      },
    });
  }
  createCodemodeExtension({ models: false })(pi);
  pi.on("session_start", () => pi.setActiveTools([...allowed]));
  pi.on("turn_start", (_event, ctx) => {
    if (++turns > 8) {
      record("budget-exceeded");
      ctx.abort();
    }
  });
  pi.on("before_agent_start", (event, ctx) =>
    record("execution", {
      model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null,
      thinking: pi.getThinkingLevel(),
      ruleLoaded: rule === undefined || event.systemPrompt.includes(rule),
      tools: pi.getActiveTools(),
    }),
  );
  pi.on("before_provider_request", (event) => {
    if (!recordValue(event.payload) || !Array.isArray(event.payload.tools)) return;
    const names = event.payload.tools.flatMap((tool) => {
      if (!recordValue(tool)) return [];
      if (typeof tool.name === "string") return [tool.name];
      return recordValue(tool.function) && typeof tool.function.name === "string"
        ? [tool.function.name]
        : [];
    });
    record("declarations", { tools: names });
  });
  pi.on("tool_call", (event) => {
    if (!allowed.has(event.toolName)) {
      record("denied", { tool: event.toolName });
      return { block: true, reason: "Tool is outside the eval allowlist" };
    }
    if (event.toolName === "codemode" && typeof event.input.code === "string") {
      scriptId = event.toolCallId;
      record("script", { id: scriptId, code: event.input.code });
      event.input.code = instrumentScript(event.input.code);
    }
    return undefined;
  });
  pi.on("tool_result", (event, ctx) => {
    if (event.toolName !== "codemode") return;
    const store = [...ctx.sessionManager.getBranch()]
      .reverse()
      .find((entry) => entry.type === "custom" && entry.customType === "codemode-store");
    const data = store?.type === "custom" ? store.data : undefined;
    const batches =
      recordValue(data) && recordValue(data.set) ? data.set.__caliper_batches : undefined;
    record("script-result", {
      id: event.toolCallId,
      error: event.isError,
      batches,
      text: event.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n"),
    });
    scriptId = undefined;
  });
  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    record("assistant", {
      stopReason: event.message.stopReason,
      hasToolCalls: event.message.content.some((block) => block.type === "toolCall"),
      text: event.message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n"),
    });
  });
  pi.on("session_shutdown", () => {
    if (watchdog) clearTimeout(watchdog);
    record("artifacts", {
      files: Object.fromEntries(
        [...allowedFiles].map((name) => [name, readFileSync(resolve(root, name), "utf8")]),
      ),
    });
  });
}
