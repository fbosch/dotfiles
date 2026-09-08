import type { ExtensionHandler } from "@earendil-works/pi-coding-agent";
import type { StartupSnapshotAPI } from "../extensions/startup-header/runtime-types";

declare module "@earendil-works/pi-coding-agent" {
  /** Compatibility declaration for the startup hook added to the packaged Pi runtime. */
  interface BeforeModelAvailabilityEvent {
    type: "before_model_availability";
    reason: SessionStartEvent["reason"];
    previousSessionFile?: string;
  }

  interface ExtensionAPI {
    on(
      event: "before_model_availability",
      handler: ExtensionHandler<BeforeModelAvailabilityEvent>,
    ): void;

    /** Optional runtime capability supplied by the maintained Pi package patch. */
    readonly startupSnapshot?: StartupSnapshotAPI;
  }
}
