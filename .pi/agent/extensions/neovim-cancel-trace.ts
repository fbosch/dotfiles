import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";

const tracePath = "/tmp/pi-neovim-cancel-trace.jsonl";
const record = (event: string, details: object = {}) => {
  appendFileSync(tracePath, `${JSON.stringify({ event, at: Date.now(), ...details })}\n`, {
    mode: 0o600,
  });
};

export default function traceNeovimCancellation(pi: ExtensionAPI): void {
  if (!process.env.PI_NVIM_SOCKET) return;
  let removeAbort: (() => void) | undefined;
  pi.on("session_start", (_, ctx) => {
    record("session_start");
    ctx.ui.onTerminalInput((data) => {
      if (matchesKey(data, "escape")) record("escape");
      if (matchesKey(data, "ctrl+c")) record("ctrl_c");
    });
  });
  pi.on("agent_start", () => record("agent_start"));
  pi.on("before_provider_request", (_, ctx) => {
    removeAbort?.();
    const signal = ctx.signal;
    record("provider_request", { hasSignal: signal !== undefined });
    if (signal === undefined) return;
    const onAbort = () => record("abort", { stack: new Error("Pi cancellation").stack });
    signal.addEventListener("abort", onAbort, { once: true });
    removeAbort = () => signal.removeEventListener("abort", onAbort);
  });
  pi.on("agent_end", () => {
    record("agent_end");
    removeAbort?.();
    removeAbort = undefined;
  });
}
