import { isMatching, P } from "ts-pattern";

const MAX_SUMMARY_CHARS = 240;
const MAX_ARGUMENT_CHARS = 60;
const MAIN_ARGUMENTS = ["path", "command", "pattern", "query", "url"] as const;

/** Pi's bounded `nestedCalls` record: structured arguments, never results. */
const NESTED_CALLS = {
  calls: P.array({
    name: P.string,
    arguments: P.optional(P.unknown),
    status: P.optional(P.string),
  }),
  complete: P.optional(P.boolean),
};
/** Codemode's own `details.calls`: arguments as JSON strings truncated near 200 characters. */
const DETAILS_CALLS = {
  calls: P.array({ name: P.string, args: P.optional(P.string), status: P.optional(P.string) }),
};

interface InnerCall {
  name: string;
  argument: string | undefined;
  failed: boolean;
}

const oneLine = (value: string): string => {
  const line = value.replace(/\s+/gu, " ").trim();
  return line.length > MAX_ARGUMENT_CHARS ? `${line.slice(0, MAX_ARGUMENT_CHARS - 1)}…` : line;
};

function mainArgument(args: unknown): string | undefined {
  for (const key of MAIN_ARGUMENTS) {
    const shape = { [key]: P.string };
    if (isMatching(shape, args) && args[key]) return oneLine(args[key]);
  }
  return undefined;
}

// Codemode truncates its argument JSON, so a cut-off string is read with a regex fallback.
function mainArgumentFromJson(args: string | undefined): string | undefined {
  if (args === undefined) return undefined;
  try {
    return mainArgument(JSON.parse(args));
  } catch {
    for (const key of MAIN_ARGUMENTS) {
      const value = args.match(new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)`, "u"))?.[1];
      if (value) return oneLine(value.replace(/\\[nrt]/gu, " "));
    }
    return undefined;
  }
}

function innerCalls(
  message: CodemodeResult,
): { calls: InnerCall[]; complete: boolean } | undefined {
  const nested = message.nestedCalls;
  if (isMatching(NESTED_CALLS, nested))
    return {
      calls: nested.calls.map((call) => ({
        name: call.name,
        argument: mainArgument(call.arguments),
        failed: call.status === "error",
      })),
      complete: nested.complete !== false,
    };
  const details = message.details;
  if (isMatching(DETAILS_CALLS, details))
    return {
      calls: details.calls.map((call) => ({
        name: call.name,
        argument: mainArgumentFromJson(call.args),
        failed: call.status === "error",
      })),
      complete: true,
    };
  return undefined;
}

interface CodemodeResult {
  toolName: string;
  nestedCalls?: unknown;
  details?: unknown;
}

/**
 * Summarizes the tools a codemode script called, for example
 * `read docs/a.md; bash bun test (failed); grep ×3`. Pi records no per-call results, so this names
 * what the script ran, not which output block came from which call. Other tools return undefined.
 */
export function codemodeCallSummary(message: CodemodeResult): string | undefined {
  if (message.toolName !== "codemode") return undefined;
  const record = innerCalls(message);
  if (!record || record.calls.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const call of record.calls) {
    const label = `${call.name}${call.argument ? ` ${call.argument}` : ""}${call.failed ? " (failed)" : ""}`;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const parts = [...counts].map(([label, count]) => (count > 1 ? `${label} ×${count}` : label));
  if (!record.complete) parts.push("record incomplete");
  let summary = "";
  for (const [index, part] of parts.entries()) {
    const remaining = parts.length - index;
    const next = summary ? `${summary}; ${part}` : part;
    // Leave room for the "+N more" suffix so the summary never exceeds its cap.
    if (next.length > MAX_SUMMARY_CHARS - (remaining > 1 ? 12 : 0))
      return summary
        ? `${summary}; +${remaining} more`
        : `${part.slice(0, MAX_SUMMARY_CHARS - 1)}…`;
    summary = next;
  }
  return summary;
}
