import { spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, readdir, rename, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"

export type RenderedContext = {
  factsheet: string
  pages: Buffer[]
  prompt: string
}

export interface ContextRenderer {
  render(text: string, modelID: string, cacheDirectory: string): Promise<RenderedContext>
  version(): Promise<string>
}

type ExportReport = {
  outDir?: unknown
}

async function runPxpipe(args: string[], stdin?: string) {
  return await new Promise<string>((resolveOutput, reject) => {
    const child = spawn("pxpipe", args, {
      stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    if (!child.stdout || !child.stderr || (stdin !== undefined && !child.stdin)) {
      child.kill()
      reject(new Error("pxpipe process streams are unavailable"))
      return
    }

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
    child.once("error", reject)
    child.once("close", (code) => {
      if (code === 0) {
        resolveOutput(Buffer.concat(stdout).toString("utf8").trim())
        return
      }

      const detail = Buffer.concat(stderr).toString("utf8").trim()
      reject(new Error(`pxpipe exited with code ${code}${detail ? `: ${detail}` : ""}`))
    })

    if (stdin !== undefined) child.stdin?.end(stdin)
  })
}

export async function loadRenderedContext(directory: string): Promise<RenderedContext> {
  const files = await readdir(directory)
  const pageNames = files.filter((file) => /^page-\d+\.png$/.test(file)).sort()
  if (pageNames.length === 0) throw new Error("pxpipe cache has no image pages")

  const [factsheet, prompt, pages] = await Promise.all([
    readFile(join(directory, "factsheet.txt"), "utf8"),
    readFile(join(directory, "prompt.txt"), "utf8"),
    Promise.all(pageNames.map((file) => readFile(join(directory, file)))),
  ])
  return { factsheet, pages, prompt }
}

export class PxpipeRenderer implements ContextRenderer {
  #version?: Promise<string>

  version() {
    this.#version ??= runPxpipe(["--version"])
    return this.#version
  }

  async render(text: string, modelID: string, cacheDirectory: string) {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "opencode-context-images-"))
    try {
      const output = await runPxpipe(
        ["export", "--stdin", "--out", temporaryRoot, "--model", modelID, "--json"],
        text,
      )
      const report = JSON.parse(output) as ExportReport
      if (typeof report.outDir !== "string") throw new Error("pxpipe returned no output directory")

      const outputDirectory = resolve(report.outDir)
      const root = resolve(temporaryRoot) + sep
      if (outputDirectory.startsWith(root) === false) {
        throw new Error("pxpipe returned an output directory outside its temporary root")
      }

      await loadRenderedContext(outputDirectory)
      await mkdir(dirname(cacheDirectory), { recursive: true })
      try {
        await rename(outputDirectory, cacheDirectory)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error
        try {
          return await loadRenderedContext(cacheDirectory)
        } catch {
          await rm(cacheDirectory, { recursive: true, force: true })
          await rename(outputDirectory, cacheDirectory)
        }
      }
      return await loadRenderedContext(cacheDirectory)
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  }
}
