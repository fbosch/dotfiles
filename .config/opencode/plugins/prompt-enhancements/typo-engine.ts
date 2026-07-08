type TypoRule = {
  from: string
  to: string
}

type WordRange = {
  start: number
  end: number
}

function camelcase(word: string): string {
  const normalized = word.replaceAll("-", "_")
  if (!normalized.includes("_") && /[a-z]/.test(normalized)) {
    return normalized.replace(/^./, (character) => character.toLowerCase())
  }

  return normalized.toLowerCase().replace(/_(.)?/g, (_match, character: string | undefined) => character?.toUpperCase() ?? "")
}

function mixedcase(word: string): string {
  return camelcase(word).replace(/^./, (character) => character.toUpperCase())
}

function splitComma(value: string): string[] {
  return value.split(",")
}

function firstBrace(value: string): [string, string, string] | undefined {
  const match = /^(.*?){(.*?)}(.*)$/.exec(value)
  if (!match) {
    return undefined
  }

  return [match[1], match[2], match[3]]
}

function expandedReplacements(targets: string[], valueMiddle: string): string[] {
  const replacements = splitComma(valueMiddle)
  if (replacements.length === 1 && replacements[0] === "") {
    return targets
  }

  return replacements
}

function expandEntry(key: string, value: string): [string, string][] | undefined {
  const keyBrace = firstBrace(key)
  if (!keyBrace) {
    return undefined
  }

  const [keyBefore, keyMiddle, keyAfter] = keyBrace
  const valueBrace = firstBrace(value)
  const [valueBefore, valueMiddle, valueAfter] = valueBrace ?? [value, ",", ""]
  const targets = splitComma(keyMiddle)
  const replacements = expandedReplacements(targets, valueMiddle)
  return targets.map((target, index) => [
    `${keyBefore}${target}${keyAfter}`,
    `${valueBefore}${replacements[index % replacements.length]}${valueAfter}`,
  ])
}

function expandOnce(dictionary: ReadonlyMap<string, string>): { expanded: Map<string, string>; shouldRecurse: boolean } {
  const expanded = new Map<string, string>()
  let shouldRecurse = false

  for (const [key, value] of dictionary) {
    const entries = expandEntry(key, value)
    if (!entries) {
      expanded.set(key, value)
      continue
    }

    shouldRecurse = true
    for (const [expandedKey, expandedValue] of entries) {
      expanded.set(expandedKey, expandedValue)
    }
  }

  return { expanded, shouldRecurse }
}

function expandBraces(dictionary: ReadonlyMap<string, string>): Map<string, string> {
  const result = expandOnce(dictionary)
  if (result.shouldRecurse) {
    return expandBraces(result.expanded)
  }

  return result.expanded
}

function parseTypoRule(line: string): TypoRule[] {
  const match = /^(\S+)\s+(\S+)$/.exec(line)
  if (!match) {
    return []
  }

  const rules: TypoRule[] = []
  const expanded = expandBraces(new Map([[match[1], match[2]]]))

  for (const [from, to] of expanded) {
    rules.push({ from: mixedcase(from), to: mixedcase(to) })
    rules.push({ from: from.toLowerCase(), to: to.toLowerCase() })
    rules.push({ from: from.toUpperCase(), to: to.toUpperCase() })
    rules.push({ from, to })
  }

  return rules
}

function isTypoRuleLine(line: string): boolean {
  return line !== "" && line.startsWith("#") === false
}

export function parseTypoRules(text: string): Map<string, string> {
  const rules = new Map<string, string>()

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (isTypoRuleLine(trimmed) === false) {
      continue
    }

    for (const rule of parseTypoRule(trimmed)) {
      rules.set(rule.from, rule.to)
    }
  }

  return rules
}

export function typoRuleLengths(rules: ReadonlyMap<string, string>): Set<number> {
  const lengths = new Set<number>()
  for (const typo of rules.keys()) {
    lengths.add(typo.length)
  }

  return lengths
}

function replacementFor(value: string, rules: ReadonlyMap<string, string>): string | undefined {
  const replacement = rules.get(value)
  if (replacement === value) {
    return undefined
  }

  return replacement
}

function ruleLengthAllows(ruleLengths: ReadonlySet<number> | undefined, word: WordRange): boolean {
  if (ruleLengths === undefined) {
    return true
  }

  return ruleLengths.has(word.end - word.start)
}

export function correctCompletedWord(
  input: string,
  rules: ReadonlyMap<string, string>,
  ruleLengths?: ReadonlySet<number>,
): string {
  const word = completedWordRange(input, true)
  if (!word) {
    return input
  }

  if (ruleLengthAllows(ruleLengths, word) === false) {
    return input
  }

  return correctedInput(input, word, rules) ?? input
}

export function appendDelimiterAndCorrect(
  input: string,
  delimiter: string,
  rules: ReadonlyMap<string, string>,
  ruleLengths?: ReadonlySet<number>,
): string {
  const word = completedWordRange(input, false)
  if (!word) {
    return input + delimiter
  }

  if (ruleLengthAllows(ruleLengths, word) === false) {
    return input + delimiter
  }

  return correctedInput(input, word, rules, delimiter) ?? input + delimiter
}

function correctedInput(
  input: string,
  word: WordRange,
  rules: ReadonlyMap<string, string>,
  suffix?: string,
): string | undefined {
  const value = input.slice(word.start, word.end)
  const replacement = replacementFor(value, rules)
  if (replacement === undefined) {
    return undefined
  }

  return input.slice(0, word.start) + replacement + (suffix ?? input.slice(word.end))
}

function trimmedWordEnd(input: string, trimTrailingDelimiters: boolean): number {
  let wordEnd = input.length
  if (trimTrailingDelimiters) {
    while (wordEnd > 0 && isWordCharacter(input.charCodeAt(wordEnd - 1)) === false) {
      wordEnd -= 1
    }
  }

  return wordEnd
}

function findWordStart(input: string, wordEnd: number): number {
  let wordStart = wordEnd
  while (wordStart > 0 && isWordCharacter(input.charCodeAt(wordStart - 1))) {
    wordStart -= 1
  }

  return wordStart
}

function completedWordRange(input: string, trimTrailingDelimiters: boolean): WordRange | undefined {
  const wordEnd = trimmedWordEnd(input, trimTrailingDelimiters)
  const wordStart = findWordStart(input, wordEnd)

  if (wordStart === wordEnd || isAsciiLetter(input.charCodeAt(wordStart)) === false) {
    return undefined
  }

  return { start: wordStart, end: wordEnd }
}

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

function isAsciiDigit(code: number): boolean {
  return code >= 48 && code <= 57
}

function isWordCharacter(code: number): boolean {
  return isAsciiLetter(code) || isAsciiDigit(code) || code === 95 || code === 39
}
