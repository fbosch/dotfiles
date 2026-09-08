import type { ExtensionHandler } from "@earendil-works/pi-coding-agent";

declare module "@earendil-works/pi-coding-agent" {
  /** Compatibility declaration for the startup hook added to the packaged Pi runtime. */
  interface BeforeModelAvailabilityEvent {
    type: "before_model_availability";
    reason: SessionStartEvent["reason"];
    previousSessionFile?: string;
  }

  type StartupSnapshotValue<T> =
    | { readonly status: "collecting" | "unavailable" }
    | { readonly status: "ready"; readonly value: T };

  interface StartupResourceCounts {
    readonly extensions: {
      readonly enabled: number;
      readonly project: number;
      readonly loadFailed: number;
    };
    readonly skills: {
      readonly available: number;
      readonly project: number;
    };
    readonly updates: {
      readonly coverage: "complete" | "partial" | "offline" | "failed";
      readonly available: number;
    };
  }

  type StartupContextCategory =
    | "system-prompt"
    | "system-tools"
    | "custom-tools"
    | "mcp-tools"
    | "context-files"
    | "skills";

  interface StartupContextEstimate {
    readonly contextWindowTokens: number;
    readonly autoCompactReserveTokens: number;
    readonly estimatedTokens: number;
    readonly categories: readonly {
      readonly id: StartupContextCategory;
      readonly tokens: number;
    }[];
  }

  interface StartupRuntimeSnapshot {
    readonly sessionId: string;
    readonly generationId: string;
    readonly ownerId: "pi-runtime";
    readonly ownerRevision: number;
    readonly resources: StartupSnapshotValue<StartupResourceCounts>;
    readonly context: StartupSnapshotValue<StartupContextEstimate>;
    readonly timing: StartupSnapshotValue<{ readonly durationMs: number }>;
  }

  interface StartupSnapshotAPI {
    readonly capability: "pi.startupSnapshot";
    readonly schemaVersion: 1;
    get(): Readonly<StartupRuntimeSnapshot>;
    subscribe(listener: (snapshot: Readonly<StartupRuntimeSnapshot>) => void): () => void;
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
