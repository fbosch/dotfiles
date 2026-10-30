import { identifierLexemes, STOP_WORDS } from "../../lib/lexical";

export interface LexicalQuery {
  /** Stemmed identifier parts and words; coverage and match counts use these. */
  terms: string[];
  /** Whole multi-part identifiers, scored as a bonus so exact matches outrank split ones. */
  compounds: string[];
}

// shortcut: suffix stripping for plain ASCII words only, not a full stemmer. Both queries and
// archives pass through it, so mismatched stems stay consistent; upgrade if the recall
// evaluation shows inflection misses that these rules cannot cover.
function stem(word: string): string {
  if (word.length < 5 || !/^[a-z]+$/u.test(word)) return word;
  let base = word;
  if (base.endsWith("ies")) base = `${base.slice(0, -3)}y`;
  else if (base.endsWith("sses")) base = base.slice(0, -2);
  else if (base.endsWith("ing") && base.length >= 6) base = base.slice(0, -3);
  else if (base.endsWith("ed") && base.length >= 5) base = base.slice(0, -2);
  else if (base.endsWith("s") && !/(?:ss|us|is)$/u.test(base)) base = base.slice(0, -1);
  if (base.length > 3 && base.endsWith("e")) base = base.slice(0, -1);
  if (/([b-df-hj-np-tv-z])\1$/u.test(base) && !/(?:ll|ss|zz)$/u.test(base))
    base = base.slice(0, -1);
  return base;
}

/** Token bag for an archive passage: stemmed parts plus whole multi-part identifiers. */
export function lexicalTokens(text: string): string[] {
  return identifierLexemes(text).flatMap(({ parts, compound }) => [
    ...parts.map(stem),
    ...(compound === undefined ? [] : [compound]),
  ]);
}

export function lexicalQuery(text: string): LexicalQuery {
  const terms = new Set<string>();
  const compounds = new Set<string>();
  for (const { parts, compound } of identifierLexemes(text)) {
    for (const part of parts) if (!STOP_WORDS.has(part)) terms.add(stem(part));
    if (compound !== undefined) compounds.add(compound);
  }
  return { terms: [...terms], compounds: [...compounds] };
}

export function countTerms(text: string, terms: readonly string[]): number {
  const tokens = new Set(lexicalTokens(text));
  return terms.filter((term) => tokens.has(term)).length;
}

export interface LexicalDocument {
  readonly counts: ReadonlyMap<string, number>;
  readonly length: number;
}

export function lexicalDocument(tokens: readonly string[]): LexicalDocument {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return { counts, length: tokens.length };
}

export function mergeDocuments(documents: readonly LexicalDocument[]): LexicalDocument {
  const counts = new Map<string, number>();
  let length = 0;
  for (const document of documents) {
    length += document.length;
    for (const [token, count] of document.counts)
      counts.set(token, (counts.get(token) ?? 0) + count);
  }
  return { counts, length };
}

const K1 = 1.2;
const B = 0.75;

/** Okapi BM25 with document frequencies taken over archive segments. */
export class Bm25Corpus {
  private readonly frequency = new Map<string, number>();
  private readonly size: number;
  private readonly averageLength: number;

  constructor(documents: readonly LexicalDocument[]) {
    let total = 0;
    for (const document of documents) {
      total += document.length;
      for (const token of document.counts.keys())
        this.frequency.set(token, (this.frequency.get(token) ?? 0) + 1);
    }
    this.size = documents.length;
    this.averageLength = documents.length === 0 ? 1 : Math.max(1, total / documents.length);
  }

  idf(term: string): number {
    const count = this.frequency.get(term) ?? 0;
    return Math.log(1 + (this.size - count + 0.5) / (count + 0.5));
  }

  /** `averageSpan` scales the average length when scoring windows of several segments. */
  score(document: LexicalDocument, query: LexicalQuery, averageSpan = 1): number {
    const norm = K1 * (1 - B + (B * document.length) / (this.averageLength * averageSpan));
    let score = 0;
    for (const term of [...query.terms, ...query.compounds]) {
      const count = document.counts.get(term) ?? 0;
      if (count > 0) score += (this.idf(term) * count * (K1 + 1)) / (count + norm);
    }
    return score;
  }
}
