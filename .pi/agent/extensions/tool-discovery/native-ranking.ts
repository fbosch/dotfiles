import type { Usage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  type DiscoveryCandidate,
  type DiscoveryMatch,
  type DiscoveryRankingOptions,
  type DiscoveryRankingResult,
  rankDiscovery,
} from "../../lib/discovery-ranking";

export interface NativeToolSearchRequest {
  query: string;
  documents: readonly { name: string; text: string; description?: string }[];
  limit: number;
  signal?: AbortSignal;
  context?: ExtensionContext;
  reportUsage?: (usage: Usage) => void;
  rankLexical: (limit: number) => DiscoveryMatch[];
}
export type NativeToolSearchRanker = (
  request: NativeToolSearchRequest,
) => Promise<DiscoveryRankingResult>;
export interface NativeToolSearchHooks {
  installToolSearchRanker: (
    registry: ExtensionContext["modelRegistry"],
    ranker: NativeToolSearchRanker,
  ) => () => void;
}

export function hasNativeToolSearchHooks(sdk: unknown): sdk is NativeToolSearchHooks {
  return (
    typeof sdk === "object" &&
    sdk !== null &&
    "installToolSearchRanker" in sdk &&
    typeof sdk.installToolSearchRanker === "function"
  );
}

export function createNativeDiscoveryRanker(
  getCandidates: (context: ExtensionContext) => readonly DiscoveryCandidate[],
  getOptions: (context: ExtensionContext) => DiscoveryRankingOptions,
): NativeToolSearchRanker {
  return async (request) => {
    request.signal?.throwIfAborted();
    if (request.context === undefined)
      throw new Error("Native discovery ranking requires a session context");
    const admitted = new Set(getCandidates(request.context).map((candidate) => candidate.name));
    const candidates = request.documents
      .filter((document) => admitted.has(document.name))
      .map((document) => ({ name: document.name, description: document.description ?? "" }));
    // Rank the full native snapshot before admission filtering so forbidden hits cannot crowd out permitted ones.
    const lexical =
      request.documents.length === 0
        ? []
        : request.rankLexical(request.documents.length).filter((item) => admitted.has(item.name));
    const ranked = await rankDiscovery(candidates, lexical, request.query, request.limit, {
      ...getOptions(request.context),
      ...(request.reportUsage === undefined ? {} : { onUsage: request.reportUsage }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    // Keep extension-only diagnostics out of the pinned SDK ranking result.
    return {
      matches: ranked.matches,
      rankingSource: ranked.rankingSource,
      ...(ranked.usage === undefined ? {} : { usage: ranked.usage }),
    };
  };
}
