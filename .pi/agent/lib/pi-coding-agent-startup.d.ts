import type { ExtensionHandler } from "@earendil-works/pi-coding-agent";

// Remove when the local Pi SDK dependency includes this event (0.85.0 or newer).
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
  }
}
