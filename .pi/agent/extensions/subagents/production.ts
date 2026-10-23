import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { type HostDependencies, registerSubagentHost } from "./host";
import type { ParentLaunch, ParentRuntime } from "./parent-runtime";

export const MINIMAL_SUBAGENTS_LAUNCH_EVENT = "minimal-subagents:launch";
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

type LaunchResult = Awaited<ReturnType<ParentRuntime["launch"]>>;
export type ProductionDependencies = Omit<HostDependencies, "runtimeChanged">;

export interface LaunchRequestEvent {
  readonly version: 1;
  readonly request: ParentLaunch;
  claim(): boolean;
  resolve(result: LaunchResult): void;
  reject(error: unknown): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isParentLaunch(value: unknown): value is ParentLaunch {
  if (
    !isRecord(value) ||
    typeof value.specialist !== "string" ||
    !value.specialist.trim() ||
    typeof value.prompt !== "string" ||
    !value.prompt.trim()
  )
    return false;
  const allowed = new Set([
    "specialist",
    "prompt",
    "foreground",
    "inheritContext",
    "maxTurns",
    "hardMaxTurns",
    "model",
    "thinking",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  if (value.foreground !== undefined && typeof value.foreground !== "boolean") return false;
  if (value.inheritContext !== undefined && typeof value.inheritContext !== "boolean") return false;
  if (
    value.maxTurns !== undefined &&
    (typeof value.maxTurns !== "number" ||
      !Number.isSafeInteger(value.maxTurns) ||
      value.maxTurns < 1)
  )
    return false;
  if (
    value.hardMaxTurns !== undefined &&
    (typeof value.hardMaxTurns !== "number" ||
      !Number.isSafeInteger(value.hardMaxTurns) ||
      value.hardMaxTurns < 1)
  )
    return false;
  if (value.model !== undefined && (typeof value.model !== "string" || !value.model.trim()))
    return false;
  if (
    value.thinking !== undefined &&
    (typeof value.thinking !== "string" || !THINKING_LEVELS.has(value.thinking))
  )
    return false;
  return true;
}

function isLaunchRequestEvent(value: unknown): value is LaunchRequestEvent {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.claim === "function" &&
    typeof value.resolve === "function" &&
    typeof value.reject === "function"
  );
}

/** Request a launch through Pi's shared event bus; rejects immediately when the runner is not loaded. */
export function requestSubagentLaunch(
  events: ExtensionAPI["events"],
  request: ParentLaunch,
): Promise<LaunchResult> {
  let claimed = false;
  let resolveResult: (result: LaunchResult) => void = () => {};
  let rejectResult: (error: Error) => void = () => {};
  const result = new Promise<LaunchResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const event: LaunchRequestEvent = {
    version: 1,
    request: Object.freeze({ ...request }),
    claim() {
      if (claimed) return false;
      claimed = true;
      return true;
    },
    resolve(value) {
      if (claimed) resolveResult(value);
    },
    reject(error) {
      if (claimed) rejectResult(error instanceof Error ? error : new Error(String(error)));
    },
  };
  events.emit(MINIMAL_SUBAGENTS_LAUNCH_EVENT, event);
  if (!claimed) rejectResult(new Error("Minimal subagents launch handler is unavailable"));
  return result;
}

export function createProductionExtension(
  options: { agentDir?: string; widgetRows?: number } = {},
  dependencies: ProductionDependencies = {},
): ExtensionFactory {
  return (pi) => {
    let runtime: ParentRuntime | undefined;
    registerSubagentHost(pi, options, {
      ...dependencies,
      runtimeChanged(next) {
        runtime = next;
      },
    });

    const unsubscribe = pi.events.on(MINIMAL_SUBAGENTS_LAUNCH_EVENT, (value) => {
      if (!isLaunchRequestEvent(value) || !value.claim()) return;
      if (!isParentLaunch(value.request)) {
        value.reject(new Error("Invalid minimal subagents launch request"));
        return;
      }
      if (!runtime) {
        value.reject(new Error("Minimal subagents runtime is not attached to an active session"));
        return;
      }
      void runtime.launch(value.request).then(value.resolve, value.reject);
    });
    pi.on("session_shutdown", (event) => {
      if (event.reason === "reload") unsubscribe();
    });
  };
}

export default createProductionExtension();
