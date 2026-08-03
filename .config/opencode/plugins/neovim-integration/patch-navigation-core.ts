export type PatchHeaderRenderable = {
  plainText?: unknown
  fg?: unknown
  parent?: PatchHeaderRenderable | null
  diff?: unknown
  isDestroyed?: boolean
  onMouseUp?: (event: { stopPropagation(): void }) => void
  getChildren?(): PatchHeaderRenderable[]
}

export type PatchedHeader = {
  block: PatchHeaderRenderable
  color: unknown
}

const patchPrefixes = ["← Patched ", "# Created "]
const moveSeparator = " → "

export function patchHeaderPath(value: unknown) {
  if (typeof value !== "string") return

  for (const prefix of patchPrefixes) {
    if (value.startsWith(prefix) && value.length > prefix.length) return value.slice(prefix.length)
  }

  if (value.startsWith("# Moved ") === false) return
  const separator = value.lastIndexOf(moveSeparator)
  if (separator === -1 || separator + moveSeparator.length === value.length) return
  return value.slice(separator + moveSeparator.length)
}

export function firstChangedLine(diff: unknown) {
  if (typeof diff !== "string") return 1

  let line: number | undefined
  for (const text of diff.split("\n")) {
    const hunk = text.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk !== null) {
      line = Number(hunk[1])
      continue
    }
    if (line === undefined) continue
    if (text.startsWith("+") || text.startsWith("-")) return Math.max(1, line)
    if (text.startsWith(" ")) line += 1
  }

  return 1
}

function blockDiff(root: PatchHeaderRenderable): unknown {
  if (typeof root.diff === "string") return root.diff
  for (const child of root.getChildren?.() ?? []) {
    const diff = blockDiff(child)
    if (diff !== undefined) return diff
  }
}

export function makePatchHeadersClickable(
  root: PatchHeaderRenderable,
  color: unknown,
  patched: Map<PatchHeaderRenderable, PatchedHeader>,
  onOpen: (path: string, line: number, event: { stopPropagation(): void }) => void,
) {
  const path = patchHeaderPath(root.plainText)
  const block = root.parent
  if (path !== undefined && block !== undefined && block !== null) {
    if (patched.has(root) === false) patched.set(root, { block, color: root.fg })
    root.fg = color
    block.onMouseUp = (event) => onOpen(path, firstChangedLine(blockDiff(block)), event)
  }

  for (const child of root.getChildren?.() ?? []) {
    makePatchHeadersClickable(child, color, patched, onOpen)
  }
}

export function restorePatchHeaders(patched: Map<PatchHeaderRenderable, PatchedHeader>) {
  for (const [header, original] of patched) {
    if (header.isDestroyed !== true) header.fg = original.color
    if (original.block.isDestroyed !== true) original.block.onMouseUp = undefined
  }
  patched.clear()
}
