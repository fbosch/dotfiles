import { join } from "node:path";
import {
  type ExtensionAPI,
  getAgentDir,
  isToolCallEventType,
} from "@earendil-works/pi-coding-agent";
import { requestClassifier } from "../../lib/classifier";
import { cachedJsonConfigReader } from "../../lib/extension-config";
import { readNonoCapabilities } from "../../lib/nono-capabilities";
import { catastrophicCommandReason } from "./catastrophic-commands";
import { type BlockedCall, createCommandReview } from "./command-review";
import { createGuardProtection } from "./protected-files";
import type { SandboxGrants } from "./sandbox";

export { resolveCommandGuardSettings } from "./command-review";

interface Dependencies {
  loadSettings: () => unknown;
  request: typeof requestClassifier;
  loadSandbox: () => SandboxGrants | undefined;
  protectedPaths?: readonly string[];
}

export default function toolCallGuard(
  pi: ExtensionAPI,
  dependencies: Dependencies = {
    // Read on every Bash call; reparse only when settings.json changes.
    loadSettings: cachedJsonConfigReader(() => join(getAgentDir(), "settings.json")),
    request: requestClassifier,
    loadSandbox: () => readNonoCapabilities(),
  },
): void {
  // One queue keeps protected-file and command dialogs from overlapping.
  let confirmations: Promise<unknown> = Promise.resolve();
  const enqueue = (task: () => Promise<BlockedCall | undefined>) => {
    const decision = confirmations.then(task);
    confirmations = decision.then(
      () => undefined,
      () => undefined,
    );
    return decision;
  };
  const protection = createGuardProtection({
    ...(dependencies.protectedPaths ? { paths: dependencies.protectedPaths } : {}),
    enqueue,
  });
  const review = createCommandReview({ ...dependencies, enqueue });

  const cancel = () => {
    protection.cancel();
    review.cancel();
  };
  const reset = () => {
    protection.cancel();
    review.reset();
  };
  pi.on("session_start", reset);
  pi.on("session_before_switch", reset);
  pi.on("session_shutdown", cancel);

  // Order matters: hard blocks are never approvable and ignore settings; protected-file
  // approval ignores classifier settings; command review alone follows commandGuard settings.
  pi.on("tool_call", (event, ctx) => {
    if (isToolCallEventType("bash", event)) {
      const reason = catastrophicCommandReason(event.input.command);
      if (reason !== undefined) return { block: true, reason };
    }
    const protectedChange = protection.check(event, ctx);
    const reviewCommand = () =>
      isToolCallEventType("bash", event) ? review.check(event, ctx) : undefined;
    // Protection resolves paths asynchronously; command review still runs when it passes.
    return protectedChange
      ? protectedChange.then((blocked) => blocked ?? reviewCommand())
      : reviewCommand();
  });
}
