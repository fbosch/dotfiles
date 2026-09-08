import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installStartupOwnerPublisher } from "./startup-header/publisher";
import {
  readStartupRuntimeSnapshot,
  readStartupSnapshotAPI,
} from "./startup-header/runtime-capability";
import type { StartupRuntimeSnapshot } from "./startup-header/runtime-types";

export default function contextViewStartupPublisher(pi: ExtensionAPI): void {
  let snapshot: StartupRuntimeSnapshot | undefined;
  let unsubscribe = () => {};
  const current = () => {
    const context = snapshot?.context;
    if (context === undefined || context.status === "unavailable") {
      return { state: "unavailable" as const };
    }
    if (context.status !== "ready") return { state: "collecting" as const };
    return { state: "ready" as const, payload: context.value };
  };
  const publisher = installStartupOwnerPublisher(pi.events, "context", current);

  pi.on("session_start", () => {
    const capability = readStartupSnapshotAPI(
      (pi as ExtensionAPI & { readonly startupSnapshot?: unknown }).startupSnapshot,
    );
    if (capability === undefined) return;
    try {
      unsubscribe();
      unsubscribe = capability.subscribe((value) => {
        const next = readStartupRuntimeSnapshot(value);
        if (next === undefined) return;
        snapshot = next;
        publisher.publish(current());
      });
      snapshot = readStartupRuntimeSnapshot(capability.get());
      publisher.publish(current());
    } catch {
      unsubscribe();
      unsubscribe = () => {};
      snapshot = undefined;
      publisher.publish({ state: "unavailable" });
    }
  });

  pi.on("session_shutdown", () => {
    unsubscribe();
    publisher.dispose();
  });
}
