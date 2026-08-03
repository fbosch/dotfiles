import { describe, expect, test } from "bun:test"
import {
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

test("makes only patch header text clickable", () => {
  const header: PatchHeaderRenderable = { plainText: "← Patched src/main.ts" }
  const diff: PatchHeaderRenderable = { plainText: "unchanged source" }
  const root: PatchHeaderRenderable = { getChildren: () => [header, diff] }
  header.parent = root
  diff.parent = root
  const opened: string[] = []
  let stopped = false

  const patched = new Map<PatchHeaderRenderable, PatchedHeader>()
  makePatchHeadersClickable(root, "orange", patched, (path, event) => {
    opened.push(path)
    event.stopPropagation()
  })
  root.onMouseUp?.({ stopPropagation: () => (stopped = true) })

  expect(header.fg).toBe("orange")
  expect(diff.onMouseUp).toBeUndefined()
  expect(header.onMouseUp).toBeUndefined()
  expect(opened).toEqual(["src/main.ts"])
  expect(stopped).toBe(true)

  restorePatchHeaders(patched)
  expect(header.fg).toBeUndefined()
  expect(root.onMouseUp).toBeUndefined()
})
