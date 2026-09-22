import type { ExtensionHandler } from "@earendil-works/pi-coding-agent";

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
