import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import herdr from "../../herdr";
import herdrAgentState from "../../herdr-agent-state";

type ExtensionHandler = (event: unknown, context: HarnessContext) => unknown;
type EventHandler = (data: unknown) => void;

interface HarnessContext {
  readonly mode: "tui";
  readonly sessionManager: {
    getSessionFile(): string;
    getSessionId(): string;
  };
  isIdle(): boolean;
}

const extensionHandlers = new Map<string, ExtensionHandler[]>();
const eventHandlers = new Map<string, EventHandler[]>();
let idle = true;
let sessionName: string | undefined = "Initial Pi session";

const context: HarnessContext = {
  mode: "tui",
  sessionManager: {
    getSessionFile: () => "/tmp/pi-herdr-fixture/session.jsonl",
    getSessionId: () => "pi-herdr-fixture-session",
  },
  isIdle: () => idle,
};

const pi = {
  events: {
    emit(channel: string, data: unknown) {
      for (const handler of eventHandlers.get(channel) ?? []) handler(data);
    },
    on(channel: string, handler: EventHandler) {
      const handlers = eventHandlers.get(channel) ?? [];
      handlers.push(handler);
      eventHandlers.set(channel, handlers);
      return () => {
        const index = handlers.indexOf(handler);
        if (index >= 0) handlers.splice(index, 1);
      };
    },
  },
  getSessionName: () => sessionName,
  on(event: string, handler: ExtensionHandler) {
    const handlers = extensionHandlers.get(event) ?? [];
    handlers.push(handler);
    extensionHandlers.set(event, handlers);
  },
} as unknown as ExtensionAPI;

async function emit(event: string, payload: unknown = {}): Promise<void> {
  for (const handler of extensionHandlers.get(event) ?? []) {
    await handler(payload, context);
  }
}

async function settleReports(): Promise<void> {
  await Bun.sleep(40);
}

herdrAgentState(pi);
herdr(pi);

await emit("session_start", { reason: "startup" });
await settleReports();

idle = false;
await emit("agent_start");
await settleReports();

await emit("ui_prompt_start", { title: "Approve fixture?" });
await settleReports();
await emit("ui_prompt_end");
await settleReports();

await emit("agent_end", {
  messages: [{ errorMessage: "fixture failure", role: "assistant", stopReason: "error" }],
});
await settleReports();
idle = true;
await emit("agent_settled");
await settleReports();

sessionName = "Renamed Pi session";
await emit("session_info_changed", { name: sessionName });
await emit("session_shutdown", { reason: "quit" });
await settleReports();

process.stdout.write(
  `${JSON.stringify({
    HERDR_ENV: process.env.HERDR_ENV ?? null,
    HERDR_PANE_ID: process.env.HERDR_PANE_ID ?? null,
    HERDR_SOCKET_PATH: process.env.HERDR_SOCKET_PATH ?? null,
    PI_NVIM_HERDR_PANE_ID: process.env.PI_NVIM_HERDR_PANE_ID ?? null,
    PI_NVIM_SOCKET: process.env.PI_NVIM_SOCKET ?? null,
  })}\n`,
);
