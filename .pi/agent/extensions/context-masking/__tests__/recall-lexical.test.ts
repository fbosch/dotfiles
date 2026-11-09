import { expect, test } from "bun:test";
import { Bm25Corpus, lexicalDocument, lexicalQuery, lexicalTokens } from "../recall-lexical";

test("streamed query-only statistics preserve full-corpus BM25 scores", () => {
  const documents = [
    "Service ægir approved receipt: receipt-123.",
    "Service freja approved receipt: receipt-456.",
    "Service ægir revised receipt: receipt-789.",
  ].map((text) => lexicalDocument(lexicalTokens(text)));
  const query = lexicalQuery("Which receipt did service ægir approve?");
  const complete = new Bm25Corpus(documents);
  const streamed = new Bm25Corpus([], new Set([...query.terms, ...query.compounds]));
  for (const document of documents) streamed.add(document);
  for (const term of query.terms) expect(streamed.idf(term)).toBe(complete.idf(term));
  for (const document of documents)
    expect(streamed.score(document, query)).toBe(complete.score(document, query));
});

test("unmatched query terms and an empty corpus retain finite BM25 statistics", () => {
  const corpus = new Bm25Corpus([], new Set(["missing"]));
  expect(Number.isFinite(corpus.idf("missing"))).toBe(true);
  expect(corpus.score(lexicalDocument([]), lexicalQuery("missing"))).toBe(0);
});
