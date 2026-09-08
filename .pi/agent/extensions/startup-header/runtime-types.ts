export type StartupSnapshotValue<T> =
  | { readonly status: "collecting" | "unavailable" }
  | { readonly status: "ready"; readonly value: T };

export interface StartupResourceCounts {
  readonly extensions: {
    readonly enabled: number;
    readonly project: number;
    readonly loadFailed: number;
  };
  readonly skills: {
    readonly available: number;
    readonly project: number;
  };
}

export type StartupContextCategory =
  | "system-prompt"
  | "system-tools"
  | "custom-tools"
  | "mcp-tools"
  | "context-files"
  | "skills"
  | "compacted-data";

export interface StartupContextEstimate {
  readonly contextWindowTokens: number;
  readonly autoCompactReserveTokens: number;
  readonly estimatedTokens: number;
  readonly categories: readonly {
    readonly id: StartupContextCategory;
    readonly tokens: number;
  }[];
}

export interface StartupRuntimeSnapshot {
  readonly sessionId: string;
  readonly generationId: string;
  readonly ownerId: "pi-runtime";
  readonly ownerRevision: number;
  readonly resources: StartupSnapshotValue<StartupResourceCounts>;
  readonly context: StartupSnapshotValue<StartupContextEstimate>;
}

export interface StartupSnapshotAPI {
  readonly capability: "pi.startupSnapshot";
  readonly schemaVersion: 1;
  get(): Readonly<StartupRuntimeSnapshot>;
  subscribe(listener: (snapshot: Readonly<StartupRuntimeSnapshot>) => void): () => void;
}
