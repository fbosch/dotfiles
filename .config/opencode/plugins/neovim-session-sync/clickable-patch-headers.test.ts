import { describe, expect, test } from "bun:test"
import {
  firstChangedLine,
  makePatchHeadersClickable,
  patchHeaderPath,
  restorePatchHeaders,
  type PatchedHeader,
  type PatchHeaderRenderable,
} from "./clickable-patch-headers"

describe("patchHeaderPath", () => {
  test("extracts paths for files that still exist", () => {
    expect(patchHeaderPath("← Patched src/main.ts")).toBe("src/main.ts")
    expect(patchHeaderPath("# Created src/new.ts")).toBe("src/new.ts")
    expect(patchHeaderPath("# Moved src/old.ts → src/new.ts")).toBe("src/new.ts")
  })

  test("ignores deleted and unrelated titles", () => {
    expect(patchHeaderPath("# Deleted src/main.ts")).toBeUndefined()
    expect(patchHeaderPath("Read src/main.ts")).toBeUndefined()
  })
})

describe("firstChangedLine", () => {
  test("finds the first changed new-file line", () => {
    expect(firstChangedLine("@@ -8,4 +8,5 @@\n context\n-old\n+new")).toBe(9)
    expect(firstChangedLine("@@ -0,0 +1,2 @@\n+first\n+second")).toBe(1)
  })

  test("uses the nearest surviving line for deletion-only hunks", () => {
    expect(firstChangedLine("@@ -20,2 +20,0 @@\n-old\n-old too")).toBe(20)
  })
})

test("makes only patch header text clickable", () => {
  const header: PatchHeaderRenderable = { plainText: "← Patched src/main.ts" }
  const diff: PatchHeaderRenderable = { plainText: "unchanged source" }
  const renderedDiff: PatchHeaderRenderable = {
    diff: "@@ -4,2 +4,2 @@\n-old\n+new",
  }
  const root: PatchHeaderRenderable = { getChildren: () => [header, diff, renderedDiff] }
  header.parent = root
  diff.parent = root
  const opened: string[] = []
  const lines: number[] = []
  let stopped = false

  const patched = new Map<PatchHeaderRenderable, PatchedHeader>()
  makePatchHeadersClickable(root, "orange", patched, (path, line, event) => {
    opened.push(path)
    lines.push(line)
    event.stopPropagation()
  })
  root.onMouseUp?.({ stopPropagation: () => (stopped = true) })

  expect(header.fg).toBe("orange")
  expect(diff.onMouseUp).toBeUndefined()
  expect(header.onMouseUp).toBeUndefined()
  expect(opened).toEqual(["src/main.ts"])
  expect(lines).toEqual([4])
  expect(stopped).toBe(true)

  restorePatchHeaders(patched)
  expect(header.fg).toBeUndefined()
  expect(root.onMouseUp).toBeUndefined()
})
