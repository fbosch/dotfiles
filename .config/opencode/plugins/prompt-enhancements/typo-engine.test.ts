import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { appendDelimiterAndCorrect, parseTypoRules } from "./typo-engine"

const vimAbolishPath = `${process.env.HOME}/.local/share/nvim/lazy/vim-abolish`

const abolishSpecRules = [
  "foo bar",
  "box{,es} bag{,s}",
  "box{,es,ed,ing} bag{,s}",
  "argu{ement,ments} argument{}",
  "foo_bar baz_qux",
  "left{One,Two} right",
  "pre{a,b}mid{x,y} post{1,2}end{3,4}",
]

function sortedEntries(map: ReadonlyMap<string, string>) {
  return [...map.entries()].sort(([left], [right]) => left.localeCompare(right))
}

async function vimAbolishRules(rules: string[]) {
  const tempDir = mkdtempSync(join(tmpdir(), "opencode-typo-parity-"))
  const scriptPath = join(tempDir, "abolish-parity.lua")

  await Bun.write(
    scriptPath,
    `
vim.opt.runtimepath:append(${JSON.stringify(vimAbolishPath)})
vim.cmd("runtime plugin/abolish.vim")

for _, line in ipairs(vim.json.decode(${JSON.stringify(JSON.stringify(rules))})) do
  vim.cmd("Abolish " .. line)
end

local rules = {}
for line in vim.fn.execute("iabbrev"):gmatch("[^\\n]+") do
  local lhs, rhs = line:match("^i%s+(%S+)%s+%*?%s*(%S+)%s*$")
  if lhs and rhs then
    rules[lhs] = rhs
  end
end

io.write(vim.json.encode(rules))
`,
  )

  try {
    const result = Bun.spawnSync(["nvim", "--headless", "-u", "NONE", "-S", scriptPath, "+qa"], {
      stdout: "pipe",
      stderr: "pipe",
    })

    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0)
    return new Map<string, string>(Object.entries(JSON.parse(new TextDecoder().decode(result.stdout))))
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

test("TypeScript typo engine matches documented vim-abolish abbreviation expansion", async () => {
  const text = abolishSpecRules.join("\n")
  const actual = parseTypoRules(text)
  const expected = await vimAbolishRules(abolishSpecRules)

  expect(sortedEntries(actual)).toEqual(sortedEntries(expected))
})

test("corrects a completed word before punctuation", () => {
  const rules = new Map([["teh", "the"]])

  for (const delimiter of [".", ",", "!", "?", ":", ";"]) {
    expect(appendDelimiterAndCorrect("teh", delimiter, rules)).toBe(`the${delimiter}`)
  }
})
