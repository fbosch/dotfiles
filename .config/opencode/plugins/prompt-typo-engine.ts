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
  const match = /(^|[^A-Za-z0-9_'])([A-Za-z][A-Za-z0-9_']*)([^A-Za-z0-9_']+)$/.exec(input)
  if (!match) {
    return input
  }

  const replacement = rules.get(match[2])
  if (replacement === undefined || replacement === match[2]) {
    return input
  }

  return input.slice(0, match.index) + match[1] + replacement + match[3]
}
