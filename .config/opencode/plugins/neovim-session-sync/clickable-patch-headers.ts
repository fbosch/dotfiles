export type PatchHeaderRenderable = {
  plainText?: unknown
  fg?: unknown
  parent?: PatchHeaderRenderable | null
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

export function makePatchHeadersClickable(
  root: PatchHeaderRenderable,
  color: unknown,
  patched: Map<PatchHeaderRenderable, PatchedHeader>,
  onOpen: (path: string, event: { stopPropagation(): void }) => void,
) {
  const path = patchHeaderPath(root.plainText)
  const block = root.parent
  if (path !== undefined && block !== undefined && block !== null) {
    if (patched.has(root) === false) patched.set(root, { block, color: root.fg })
    root.fg = color
    block.onMouseUp = (event) => onOpen(path, event)
  }

  for (const child of root.getChildren?.() ?? []) {
    makePatchHeadersClickable(child, color, patched, onOpen)
  }
}

export function restorePatchHeaders(patched: Map<PatchHeaderRenderable, PatchedHeader>) {
  for (const [header, original] of patched) {
    header.fg = original.color
    original.block.onMouseUp = undefined
  }
  patched.clear()
}
