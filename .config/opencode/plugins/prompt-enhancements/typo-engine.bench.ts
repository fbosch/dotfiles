import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { correctCompletedWord, parseTypoRules } from "./typo-engine"

type BenchResult = {
  name: string
  iterations: number
  totalMs: number
  meanUs: number
  opsPerSecond: number
}

const typoRulesPath = resolve(import.meta.dir, "../../../fbb/data/typos.abolish")
const typoRulesText = readFileSync(typoRulesPath, "utf8")
const rules = parseTypoRules(typoRulesText)

const cases = {
  shortNoMatch: "please fix this ",
  shortMatch: "please fix teh ",
  longNoMatch: `${"review this implementation carefully ".repeat(40)}before sending `,
  longMatch: `${"review this implementation carefully ".repeat(40)}teh `,
}

const focusedPromptRef = { focused: true }
const promptRefs = new Set([focusedPromptRef])

function nowNs(): bigint {
  return process.hrtime.bigint()
}

function bench(name: string, iterations: number, run: () => void): BenchResult {
  for (let index = 0; index < Math.min(iterations, 10_000); index += 1) {
    run()
  }

  const start = nowNs()
  for (let index = 0; index < iterations; index += 1) {
    run()
  }
  const totalMs = Number(nowNs() - start) / 1_000_000

  return {
    name,
    iterations,
    totalMs,
    meanUs: (totalMs * 1_000) / iterations,
    opsPerSecond: iterations / (totalMs / 1_000),
  }
}

function printResult(result: BenchResult) {
  console.log(
    `${result.name.padEnd(30)} ${result.meanUs.toFixed(3).padStart(9)} us/op  ${Math.round(result.opsPerSecond).toLocaleString().padStart(12)} ops/s  ${result.iterations.toLocaleString()} iters`,
  )
}

console.log(`rules: ${rules.size}`)
console.log(`typo file bytes: ${typoRulesText.length}`)
console.log("")

for (const result of [
  bench("parse shared typo rules", 20_000, () => {
    parseTypoRules(typoRulesText)
  }),
  bench("correct short no match", 1_000_000, () => {
    correctCompletedWord(cases.shortNoMatch, rules)
  }),
  bench("correct short match", 1_000_000, () => {
    correctCompletedWord(cases.shortMatch, rules)
  }),
  bench("correct long no match", 500_000, () => {
    correctCompletedWord(cases.longNoMatch, rules)
  }),
  bench("correct long match", 500_000, () => {
    correctCompletedWord(cases.longMatch, rules)
  }),
  bench("find ref via set spread", 1_000_000, () => {
    ;[...promptRefs].find((promptRef) => promptRef.focused)
  }),
  bench("read active ref directly", 1_000_000, () => {
    focusedPromptRef.focused ? focusedPromptRef : undefined
  }),
]) {
  printResult(result)
}
