export type TypoRule = {
  from: string
  to: string
}

function camelcase(word: string): string {
  const normalized = word.replaceAll("-", "_")
  if (!normalized.includes("_") && /[a-z]/.test(normalized)) {
    return normalized.replace(/^./, (character) => character.toLowerCase())
  }

  let result = ""
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] === "_") {
      index += 1
      result += normalized[index]?.toUpperCase() ?? ""
      continue
    }

    result += normalized[index]?.toLowerCase() ?? ""
  }

  return result
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

function expandBraces(dictionary: ReadonlyMap<string, string>): Map<string, string> {
  const expanded = new Map<string, string>()
  let shouldRecurse = false

  for (const [key, value] of dictionary) {
    const keyBrace = firstBrace(key)
    if (!keyBrace) {
      expanded.set(key, value)
      continue
    }

    shouldRecurse = true
    const [keyBefore, keyMiddle, keyAfter] = keyBrace
    const valueBrace = firstBrace(value)
    const [valueBefore, valueMiddle, valueAfter] = valueBrace ?? [value, ",", ""]
    const targets = splitComma(keyMiddle)
    let replacements = splitComma(valueMiddle)

    if (replacements.length === 1 && replacements[0] === "") {
      replacements = targets
    }

    for (let index = 0; index < targets.length; index += 1) {
      expanded.set(
        `${keyBefore}${targets[index]}${keyAfter}`,
        `${valueBefore}${replacements[index % replacements.length]}${valueAfter}`,
      )
    }
  }

  if (shouldRecurse) {
    return expandBraces(expanded)
  }

  return expanded
}

export function parseTypoRule(line: string): TypoRule[] {
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

export function parseTypoRules(text: string): Map<string, string> {
  const rules = new Map<string, string>()

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue
    }

    for (const rule of parseTypoRule(trimmed)) {
      rules.set(rule.from, rule.to)
    }
  }

  return rules
}

export function correctCompletedWord(input: string, rules: ReadonlyMap<string, string>): string {
  let wordEnd = input.length
  while (wordEnd > 0 && isWordCharacter(input.charCodeAt(wordEnd - 1)) === false) {
    wordEnd -= 1
  }

  let wordStart = wordEnd
  while (wordStart > 0 && isWordCharacter(input.charCodeAt(wordStart - 1))) {
    wordStart -= 1
  }

  if (wordStart === wordEnd || isAsciiLetter(input.charCodeAt(wordStart)) === false) {
    return input
  }

  const word = input.slice(wordStart, wordEnd)
  const replacement = rules.get(word)
  if (replacement === undefined || replacement === word) {
    return input
  }

  return input.slice(0, wordStart) + replacement + input.slice(wordEnd)
}

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

function isWordCharacter(code: number): boolean {
  return isAsciiLetter(code) || (code >= 48 && code <= 57) || code === 95 || code === 39
}
