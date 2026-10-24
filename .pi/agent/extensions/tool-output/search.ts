import { isAbsolute } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import type { OutputArtifacts } from "./artifacts";
import { MAX_OUTPUT_BYTES } from "./policy";
export const SEARCH_TOOL = "tool_output_search";
export const SEARCH_MAX_BYTES = 6_000;

const Parameters = Type.Object({
  path: Type.String({ description: "Full output artifact path from a Bash preview" }),
  queries: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
    minItems: 1,
    maxItems: 8,
    description: "Literal substrings, OR-matched; no regex",
  }),
  offset: Type.Optional(
    Type.Integer({
      minimum: 1,
      description:
        "First source line to return matches from; counts still cover the whole artifact",
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 20,
      description: "Maximum matching lines to return, default 20",
    }),
  ),
  context: Type.Optional(
    Type.Integer({
      minimum: 0,
      maximum: 3,
      description: "Adjacent lines per match, default 1; may be reduced to fit output",
    }),
  ),
  ignoreCase: Type.Optional(Type.Boolean()),
});
export type SearchInput = Static<typeof Parameters>;
const Output = Type.Object({
  path: Type.String(),
  scope: Type.Literal("entire-artifact-literal-matches"),
  totalLines: Type.Integer(),
  offset: Type.Integer(),
  queryCounts: Type.Array(Type.Object({ query: Type.String(), matchingLines: Type.Integer() })),
  matchingLines: Type.Integer(),
  returnedMatches: Type.Integer(),
  nextOffset: Type.Union([Type.Integer(), Type.Null()]),
  pageComplete: Type.Boolean(),
  allMatchesReturned: Type.Boolean(),
  contextReduced: Type.Boolean(),
  excerpts: Type.Array(
    Type.Object({
      matchLine: Type.Integer(),
      from: Type.Integer(),
      to: Type.Integer(),
      text: Type.String(),
    }),
  ),
});
export type SearchOutput = Static<typeof Output>;

export function searchText(text: string, input: SearchInput): SearchOutput {
  const { offset = 1, limit = 20, context = 1, ignoreCase = false } = input;
  if (
    !isAbsolute(input.path) ||
    input.queries.length < 1 ||
    input.queries.length > 8 ||
    input.queries.some((q) => q.length === 0 || q.length > 256) ||
    !Number.isSafeInteger(offset) ||
    offset < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 20 ||
    !Number.isSafeInteger(context) ||
    context < 0 ||
    context > 3 ||
    Buffer.byteLength(text) > MAX_OUTPUT_BYTES
  )
    throw new Error("Invalid output search request.");
  const lines = text.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
  const needles = input.queries.map((q) => (ignoreCase ? q.toLowerCase() : q));
  const counts = needles.map(() => 0);
  const matches: number[] = [];
  for (const [i, line] of lines.entries()) {
    const haystack = ignoreCase ? line.toLowerCase() : line;
    let matched = false;
    needles.forEach((query, n) => {
      if (haystack.includes(query)) {
        counts[n] = (counts[n] ?? 0) + 1;
        matched = true;
      }
    });
    if (matched) matches.push(i);
  }
  const result: SearchOutput = {
    path: input.path,
    scope: "entire-artifact-literal-matches",
    totalLines: lines.length,
    offset,
    queryCounts: input.queries.map((query, i) => ({ query, matchingLines: counts[i] ?? 0 })),
    matchingLines: matches.length,
    returnedMatches: 0,
    nextOffset: null,
    pageComplete: true,
    allMatchesReturned: offset === 1,
    contextReduced: false,
    excerpts: [],
  };
  if (Buffer.byteLength(JSON.stringify(result)) > SEARCH_MAX_BYTES - 64)
    throw new Error("Output search metadata exceeds the response budget.");
  for (const index of matches.filter((i) => i + 1 >= offset)) {
    if (result.returnedMatches >= limit) {
      result.nextOffset = index + 1;
      break;
    }
    let radius = context;
    while (true) {
      const from = Math.max(0, index - radius);
      const to = Math.min(lines.length, index + radius + 1);
      const excerpt = {
        matchLine: index + 1,
        from: from + 1,
        to,
        text: lines.slice(from, to).join(""),
      };
      // Measure serialized output, including escaped source text and metadata, not just source bytes.
      const candidate = {
        ...result,
        nextOffset: index + 1,
        returnedMatches: result.returnedMatches + 1,
        excerpts: [...result.excerpts, excerpt],
      };
      if (Buffer.byteLength(JSON.stringify(candidate)) <= SEARCH_MAX_BYTES - 64) {
        result.excerpts.push(excerpt);
        result.returnedMatches++;
        result.contextReduced ||= radius < context;
        break;
      }
      if (radius > 0 && result.excerpts.length === 0) {
        radius--;
        continue;
      }
      if (result.excerpts.length === 0)
        throw new Error("Output search match exceeds the response budget.");
      result.nextOffset = index + 1;
      break;
    }
    if (result.nextOffset !== null) break;
  }
  result.pageComplete = result.nextOffset === null;
  result.allMatchesReturned = offset === 1 && result.pageComplete;
  return result;
}

export function createOutputSearchTool(artifacts: Pick<OutputArtifacts, "search">) {
  return {
    name: SEARCH_TOOL,
    label: "Search tool output",
    description:
      "Search a registered tool output artifact using literal substrings. Counts scan the entire artifact; bounded verbatim excerpts include source line numbers and nextOffset. Zero matches means no literal match, not absence of other evidence. Use read for full output or edit anchors.",
    parameters: Parameters,
    outputSchema: Output,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    async execute(
      _id: string,
      input: SearchInput,
      signal: AbortSignal | undefined,
      _update: unknown,
      ctx: ExtensionContext,
    ) {
      const result = await artifacts.search(ctx, input, signal);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        details: undefined,
        structuredContent: result,
      };
    },
  };
}
