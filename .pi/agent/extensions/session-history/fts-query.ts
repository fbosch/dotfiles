import { identifierLexemes, STOP_WORDS } from "../../lib/lexical";

/** `partial` requires two terms when the query has three or more, otherwise any one term. */
export type MatchMode = "all" | "any" | "partial";

/** Partial matching enumerates term pairs, so it uses only the first few terms. */
const PARTIAL_TERM_LIMIT = 8;

function quote(term: string): string {
  return `"${term.replaceAll('"', '""')}"`;
}

/**
 * Builds one quoted FTS5 term per query word, dropping stop words unless nothing else is left.
 * A camelCase or snake_case word also matches its split parts as a phrase in the `terms` column.
 */
function queryTerms(input: string): string[] {
  const terms: string[] = [];
  const stops: string[] = [];
  const phrase = /"([^"]+)"/g;
  for (const match of input.matchAll(phrase)) {
    const value = match[1]?.trim();
    if (value) terms.push(quote(value));
  }
  for (const raw of input.replace(phrase, " ").match(/[\p{L}\p{N}_][\p{L}\p{N}_.\-/]*/gu) ?? []) {
    const token = raw.replace(/[.\-/]+$/, "");
    if (!token) continue;
    if (STOP_WORDS.has(token.toLowerCase())) {
      stops.push(quote(token));
      continue;
    }
    const [lexeme, ...rest] = identifierLexemes(token);
    terms.push(
      lexeme?.compound !== undefined && rest.length === 0
        ? `(${quote(token)} OR terms:${quote(lexeme.parts.join(" "))})`
        : quote(token),
    );
  }
  return [...new Set(terms.length > 0 ? terms : stops)];
}

/**
 * Converts free text into a safe FTS5 expression, or undefined when nothing is searchable.
 * User input never reaches FTS5 operator syntax.
 */
export function ftsExpression(input: string, mode: MatchMode): string | undefined {
  const terms = queryTerms(input);
  if (terms.length === 0) return undefined;
  // FTS5 accepts implicit AND only between plain phrases, not after a parenthesized group.
  if (mode === "all") return terms.join(" AND ");
  if (mode === "any" || terms.length < 3) return terms.join(" OR ");
  const limited = terms.slice(0, PARTIAL_TERM_LIMIT);
  const pairs: string[] = [];
  for (const [index, first] of limited.entries())
    for (const second of limited.slice(index + 1)) pairs.push(`(${first} AND ${second})`);
  return pairs.join(" OR ");
}
