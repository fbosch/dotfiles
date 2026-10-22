// Short-form word matching and inline colouring adapted from cc-stretch's hooks/grow.ts and hooks/layout.ts.
// Copyright (c) 2026 pro-vi, MIT License: https://github.com/pro-vi/cc-stretch

import { Option } from "./monad";
import type { Segment, Stretch } from "./parse";

type Token = { kind: "word" | "space"; text: string } | { kind: "nested"; stretch: Stretch };

/** A word of the long form, by the index of the token holding it. */
type Placed = { token: number; word: string };

/** A mark drawn on the letter before it, or a character no terminal draws, such as a joiner. */
const ZERO_WIDTH = /[\p{Mn}\p{Me}\p{Default_Ignorable_Code_Point}]/u;
/** Scripts written without spaces, where a row may break between any two characters. */
const UNSPACED =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Bopomofo}　-〿＀-￯]/u;
/** Scripts written without spaces whose words only a dictionary finds. */
const SEGMENTED = /[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
/** Characters a row may not start with. */
const NO_START =
  /[\p{Pe}\p{Pf},.:;!?，。、；：？！…·ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶーゝゞヽヾ々]/u;
/** Characters a row may not end with. */
const NO_END = /[\p{Ps}\p{Pi}]/u;
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: "word" });
/**
 * A code span or inline math, as Pi's Markdown finds them: `code`, \(…\), \[…\], $$…$$, $…$. Each
 * stays whole within its word, so no paint lands inside it, where Markdown would show it as text or
 * LaTeX would take it for an argument.
 */
const SPAN =
  String.raw`(` + "`+" + String.raw`)[^]*?\1|\\\(.*?\\\)|\\\[.*?\\\]|\$\$.*?\$\$|\$(?!\s).*?\$`;
const HAS_SPAN = new RegExp(SPAN);
/** A word, spans in it whole even across spaces, or a run of spaces. */
const WORD_OR_SPACES = new RegExp(String.raw`(?:${SPAN}|\S)+|\s+`, "g");

/** Preserve short-form words unpainted while colouring the additional inline words. */
export function paintExpansion(
  short: string,
  long: readonly Segment[],
  draw: (nested: Stretch) => string,
  paint: (word: string) => string = (word) => word,
): string {
  const tokens = tokenize(long);
  const anchors = anchorsOf(short, tokens);
  return tokens
    .map((token, index) => {
      if (token.kind === "nested") return draw(token.stretch);
      return token.kind === "space" || anchors.has(index) ? token.text : paint(token.text);
    })
    .join("");
}

function tokenize(long: readonly Segment[]): Token[] {
  return long.flatMap((part): Token[] =>
    typeof part === "string"
      ? (part.match(WORD_OR_SPACES) ?? []).flatMap((text): Token[] =>
          /^\s+$/.test(text)
            ? [{ kind: "space", text }]
            : piecesOfWord(text).map((word) => ({ kind: "word", text: word })),
        )
      : [{ kind: "nested", stretch: part }],
  );
}

/** A word cut where a row may break, or whole when it holds code or math. */
const piecesOfWord = (word: string) => (HAS_SPAN.test(word) ? [word] : breakables(word));

/** Split unspaced scripts into painting units without separating punctuation or combining marks. */
function breakables(text: string): string[] {
  // Nothing below Thai breaks, so a Latin word or a run of spaces comes back whole without a look at
  // each character.
  if (!/[^\0-෿]/.test(text)) return [text];
  const wordStarts = new Set<number>();
  if (SEGMENTED.test(text)) for (const word of SEGMENTER.segment(text)) wordStarts.add(word.index);
  const pieces: string[] = [];
  let piece = "";
  let last = "";
  let isAfterUnspaced = false;
  let at = 0;
  for (const char of text) {
    const isUnspaced = UNSPACED.test(char);
    const isWordStart = wordStarts.has(at) && SEGMENTED.test(last + char);
    const mayBreak = isUnspaced || isAfterUnspaced || isWordStart;
    if (
      piece !== "" &&
      mayBreak &&
      !NO_START.test(char) &&
      !NO_END.test(last) &&
      !ZERO_WIDTH.test(char)
    ) {
      pieces.push(piece);
      piece = "";
    }
    piece += char;
    last = char;
    isAfterUnspaced = isUnspaced || (isAfterUnspaced && NO_START.test(char));
    at += char.length;
  }
  if (piece !== "") pieces.push(piece);
  return pieces;
}

/**
 * The token indexes of the long form that carry the short form's words, as many as can be kept in
 * order. A nested stretch shows its own short form, so its words count where it stands.
 */
function anchorsOf(short: string, tokens: Token[]): ReadonlySet<number> {
  const want = wordsIn(short)
    .map(bare)
    .filter((word) => word !== "");
  const have = tokens.flatMap((token, i): Placed[] =>
    wordsOf(token)
      .map(bare)
      .filter((word) => word !== "")
      .map((word) => ({ token: i, word })),
  );
  const anchors = new Set(
    inOrder(want, have).match({ some: (found) => found, none: () => longestCommon(want, have) }),
  );

  // Punctuation standing on its own right after an anchor (`{{...}}.`) belongs to that anchor.
  let last = -1;
  tokens.forEach((token, i) => {
    if (token.kind === "space") return;
    if (token.kind === "word" && bare(token.text) === "" && anchors.has(last)) anchors.add(i);
    last = i;
  });
  return anchors;
}

const wordsIn = (text: string) =>
  (text.match(WORD_OR_SPACES) ?? []).filter((word) => !/^\s+$/.test(word)).flatMap(piecesOfWord);

const wordsOf = (token: Token) =>
  token.kind === "word"
    ? [token.text]
    : token.kind === "nested"
      ? wordsIn(token.stretch.short)
      : [];

/**
 * The tokens carrying the earliest match of each wanted word, none when some word finds no place.
 * The guide asks the long form to keep every word of the short form, in order, and when it does,
 * these are already the longest common subsequence: a Chinese long form, with a word per
 * character, never pays for the table `longestCommon` builds.
 */
function inOrder(want: string[], have: Placed[]): Option<number[]> {
  const found: number[] = [];
  for (const { token, word } of have) {
    if (found.length === want.length) break;
    if (word === want[found.length]) found.push(token);
  }
  return found.length === want.length ? Option.some(found) : Option.none;
}

/** The tokens carrying the most wanted words that can be kept in order, a longest common subsequence. */
function longestCommon(want: string[], have: Placed[]): number[] {
  // lengths[i][j]: the longest common run of want[i..] and have[j..].
  const lengths = Array.from({ length: want.length + 1 }, () =>
    new Array<number>(have.length + 1).fill(0),
  );
  for (let i = want.length - 1; i >= 0; i--) {
    for (let j = have.length - 1; j >= 0; j--) {
      lengths[i]![j] =
        want[i] === have[j]!.word
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }
  const found: number[] = [];
  for (let i = 0, j = 0; i < want.length && j < have.length; ) {
    if (want[i] === have[j]!.word) {
      found.push(have[j]!.token);
      i++;
      j++;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) i++;
    else j++;
  }
  return found;
}

/** A word without its surrounding punctuation or markdown marks, lowercased, so `cache.` meets `**cache**`. */
const bare = (word: string) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLowerCase();
