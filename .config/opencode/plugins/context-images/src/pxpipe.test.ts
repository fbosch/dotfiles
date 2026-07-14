import { expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PxpipeRenderer } from "./pxpipe"

test("PxpipeRenderer invalidates its cache identity when the executable changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pxpipe-renderer-test-"))
  const executable = join(directory, "pxpipe")
  try {
    await writeFile(executable, "#!/bin/sh\nexit 0\n")
    await chmod(executable, 0o755)
    const renderer = new PxpipeRenderer(executable)
    const original = await renderer.version()

    await writeFile(executable, "#!/bin/sh\nexit 1\n")

    expect(await renderer.version()).toBe(original)
    expect(await new PxpipeRenderer(executable).version()).not.toBe(original)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("PxpipeRenderer renders through the installed library", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pxpipe-renderer-test-"))
  const executable = join(directory, "pxpipe")
  try {
    await writeFile(executable, "#!/bin/sh\nexit 99\n")
    await chmod(executable, 0o755)
    const moduleDirectory = join(directory, "lib", "pxpipe", "dist", "core")
    await mkdir(moduleDirectory, { recursive: true })
    await writeFile(
      join(moduleDirectory, "export.js"),
      `
export const DEFAULT_EXPORT_COLS = 312
export const DEFAULT_EXPORT_MODEL = "model"
export async function runExportCore() {
  const encode = (value) => new TextEncoder().encode(value)
  return { artifacts: [
    { filename: "factsheet.txt", data: encode("library factsheet") },
    { filename: "prompt.txt", data: encode("library prompt") },
    { filename: "page-001.png", data: encode("library page") },
  ] }
}
`,
    )

    const renderer = new PxpipeRenderer(executable)
    await renderer.preload()
    const rendered = await renderer.render("instructions", "model", join(directory, "cache"))

    expect(rendered.prompt).toBe("library prompt")
    expect(rendered.pages[0]?.toString()).toBe("library page")
    expect((await stat(join(directory, "cache"))).mode & 0o777).toBe(0o700)
    expect((await stat(join(directory, "cache", "page-001.png"))).mode & 0o777).toBe(0o600)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("PxpipeRenderer falls back to the CLI when library rendering fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pxpipe-renderer-test-"))
  const executable = join(directory, "pxpipe")
  try {
    const moduleDirectory = join(directory, "lib", "pxpipe", "dist", "core")
    await mkdir(moduleDirectory, { recursive: true })
    await writeFile(
      join(moduleDirectory, "export.js"),
      "export const DEFAULT_EXPORT_COLS = 312\nexport const DEFAULT_EXPORT_MODEL = 'model'\nexport async function runExportCore() { throw new Error('failed') }\n",
    )
    await writeFile(
      executable,
      `#!/usr/bin/env bun
import { mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"
const args = process.argv.slice(2)
const out = args[args.indexOf("--out") + 1]
const directory = await mkdtemp(join(out, "pxpipe-export-"))
await Promise.all([
  writeFile(join(directory, "factsheet.txt"), "cli factsheet"),
  writeFile(join(directory, "prompt.txt"), "cli prompt"),
  writeFile(join(directory, "page-001.png"), "cli page"),
])
console.log(JSON.stringify({ outDir: directory }))
`,
    )
    await chmod(executable, 0o755)

    const rendered = await new PxpipeRenderer(executable).render("instructions", "model", join(directory, "cache"))

    expect(rendered.prompt).toBe("cli prompt")
    expect(rendered.pages[0]?.toString()).toBe("cli page")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
