type TypoRule = {
  from: string;
  to: string;
};

function camelcase(word: string): string {
  const normalized = word.replaceAll("-", "_");
  if (!normalized.includes("_") && /[a-z]/.test(normalized)) {
    return normalized.replace(/^./, (character) => character.toLowerCase());
  }

  return normalized
    .toLowerCase()
    .replace(/_(.)/gu, (_match, character: string) => character.toUpperCase());
}

function mixedcase(word: string): string {
  return camelcase(word).replace(/^./, (character) => character.toUpperCase());
}

function splitComma(value: string): string[] {
  return value.split(",");
}

function firstBrace(value: string): [string, string, string] | undefined {
  const match = /^(.*?){(.*?)}(.*)$/.exec(value);
  if (!match) return undefined;

  const before = match[1];
  const middle = match[2];
  const after = match[3];
  if (before === undefined || middle === undefined || after === undefined) return undefined;

  return [before, middle, after];
}

function expandedReplacements(targets: string[], valueMiddle: string): string[] {
  const replacements = splitComma(valueMiddle);
  if (replacements.length === 1 && replacements[0] === "") return targets;

  return replacements;
}

function expandEntry(key: string, value: string): [string, string][] | undefined {
  const keyBrace = firstBrace(key);
  if (!keyBrace) return undefined;

  const [keyBefore, keyMiddle, keyAfter] = keyBrace;
  const valueBrace = firstBrace(value);
  const [valueBefore, valueMiddle, valueAfter] = valueBrace ?? [value, ",", ""];
  const targets = splitComma(keyMiddle);
  const replacements = expandedReplacements(targets, valueMiddle);
  return targets.map((target, index) => [
    `${keyBefore}${target}${keyAfter}`,
    `${valueBefore}${replacements[index % replacements.length]}${valueAfter}`,
  ]);
}

function expandOnce(dictionary: ReadonlyMap<string, string>): {
  expanded: Map<string, string>;
  shouldRecurse: boolean;
} {
  const expanded = new Map<string, string>();
  let shouldRecurse = false;

  for (const [key, value] of dictionary) {
    const entries = expandEntry(key, value);
    if (!entries) {
      expanded.set(key, value);
      continue;
    }

    shouldRecurse = true;
    for (const [expandedKey, expandedValue] of entries) {
      expanded.set(expandedKey, expandedValue);
    }
  }

  return { expanded, shouldRecurse };
}

function expandBraces(dictionary: ReadonlyMap<string, string>): Map<string, string> {
  const result = expandOnce(dictionary);
  if (result.shouldRecurse) return expandBraces(result.expanded);

  return result.expanded;
}

function parseTypoRule(line: string): TypoRule[] {
  const match = /^(\S+)\s+(.+)$/.exec(line);
  if (!match) throw new Error("expected a typo pattern and replacement");

  const [, fromPattern, toPattern] = match;
  if (fromPattern === undefined || toPattern === undefined) throw new Error("missing rule fields");
  for (const pattern of [fromPattern, toPattern]) {
    if (!/^(?:[^{}]|\{[^{}]*\})*$/.test(pattern)) {
      throw new Error("unbalanced or nested braces; use flat Abolish groups");
    }
  }
  const rules: TypoRule[] = [];
  const expanded = expandBraces(new Map([[fromPattern, toPattern]]));

  for (const [from, to] of expanded) {
    if (!/^[\p{L}\p{M}\p{Nd}_\u00c0-\u00ff]+$/u.test(from)) {
      throw new Error(`expanded typo is not a keyword: ${JSON.stringify(from)}`);
    }
    if (/[{}]/.test(to)) throw new Error("replacement has an unmatched brace group");
    rules.push({ from: mixedcase(from), to: mixedcase(to) });
    rules.push({ from: from.toLowerCase(), to: to.toLowerCase() });
    rules.push({ from: from.toUpperCase(), to: to.toUpperCase() });
    rules.push({ from, to });
  }

  return rules;
}

function isTypoRuleLine(line: string): boolean {
  return line !== "" && line.startsWith("#") === false;
}

export function parseTypoRules(text: string): Map<string, string> {
  const rules = new Map<string, string>();

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (isTypoRuleLine(trimmed) === false) continue;

    try {
      for (const rule of parseTypoRule(trimmed)) {
        rules.set(rule.from, rule.to);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid typo rule on line ${index + 1}: ${message}`, { cause: error });
    }
  }

  return rules;
}

export function typoRuleLengths(rules: ReadonlyMap<string, string>): Set<number> {
  const lengths = new Set<number>();
  for (const typo of rules.keys()) lengths.add(typo.length);

  return lengths;
}

function ruleLengthAllows(
  ruleLengths: ReadonlySet<number> | undefined,
  wordStart: number,
  wordEnd: number,
): boolean {
  if (ruleLengths === undefined) return true;

  return ruleLengths.has(wordEnd - wordStart);
}

export function appendDelimiterAndCorrect(
  input: string,
  delimiter: string,
  rules: ReadonlyMap<string, string>,
  ruleLengths?: ReadonlySet<number>,
): string {
  const wordEnd = input.length;
  const wordStart = completedWordStart(input, wordEnd);
  if (wordStart === undefined) return input + delimiter;

  if (ruleLengthAllows(ruleLengths, wordStart, wordEnd) === false) return input + delimiter;

  const replacement = replacementForWord(input, wordStart, wordEnd, rules);
  if (replacement === undefined) return input + delimiter;

  return input.slice(0, wordStart) + replacement + delimiter;
}

function replacementForWord(
  input: string,
  wordStart: number,
  wordEnd: number,
  rules: ReadonlyMap<string, string>,
): string | undefined {
  const value = input.slice(wordStart, wordEnd);
  const replacement = rules.get(value);
  if (replacement === undefined || replacement === value) return undefined;

  return replacement;
}

// Neovim's default iskeyword: Unicode letters/marks/digits, _, and Latin-1 192–255.
const KEYWORD_CHARACTER = /^[\p{L}\p{M}\p{Nd}_\u00c0-\u00ff]$/u;
const COMPLETED_WORD = /[\p{L}\p{M}\p{Nd}_\u00c0-\u00ff]+$/u;

export function isTypoDelimiter(character: string): boolean {
  return [...character].length === 1 && !KEYWORD_CHARACTER.test(character);
}

function completedWordStart(input: string, wordEnd: number): number | undefined {
  return COMPLETED_WORD.exec(input.slice(0, wordEnd))?.index;
}
