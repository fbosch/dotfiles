import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { access, chmod, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises"
import { basename, delimiter, dirname, join, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"

const MAX_PROCESS_OUTPUT_BYTES = 1024 * 1024
const PROCESS_TIMEOUT_MS = 60_000
const MAX_TOKEN_ESTIMATE = 100_000_000

export type RenderedContext = {
  factsheet: string
  pages: Buffer[]
  prompt: string
  tokenReport: {
    imageTokens: number
    textTokens: number
  }
}

export interface ContextRenderer {
  render(text: string, modelID: string, cacheDirectory: string): Promise<RenderedContext>
  version(): Promise<string>
}

type ExportReport = {
  outDir?: unknown
}

type RenderOutput = {
  directory: string
  rendered?: RenderedContext
}

type ExportModule = {
  DEFAULT_EXPORT_COLS: number
  DEFAULT_EXPORT_MODEL: string
  runExportCore(
    text: string,
    options: { cols: number; model: string; sourceFiles: string[] },
  ): Promise<{ artifacts: { data: Uint8Array; filename: string }[] }>
}

function parseTokenReport(value: unknown) {
  if (typeof value !== "object" || value === null || !("tokenReport" in value)) {
    throw new Error("pxpipe cache has no token report")
  }
  const report = value.tokenReport
  if (
    typeof report !== "object" ||
    report === null ||
    !("textTokens" in report) ||
    !Number.isSafeInteger(report.textTokens) ||
    (report.textTokens as number) <= 0 ||
    (report.textTokens as number) > MAX_TOKEN_ESTIMATE ||
    !("imageTokens" in report) ||
    !Number.isSafeInteger(report.imageTokens) ||
    (report.imageTokens as number) <= 0 ||
    (report.imageTokens as number) > MAX_TOKEN_ESTIMATE
  ) {
    throw new Error("pxpipe cache has an invalid token report")
  }
  return { textTokens: report.textTokens as number, imageTokens: report.imageTokens as number }
}

async function resolveExecutable(command: string) {
  if (command.includes(sep)) return await realpath(command)

  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = join(directory || ".", command)
    try {
      await access(candidate, constants.X_OK)
      return await realpath(candidate)
    } catch {
      continue
    }
  }
  throw new Error(`${command} executable was not found in PATH`)
}

async function executableIdentity(command: string) {
  const executable = await resolveExecutable(command)
  const content = await readFile(executable)
  return createHash("sha256").update(executable).update("\0").update(content).digest("hex")
}

async function findExportModule(command: string) {
  let directory = dirname(await resolveExecutable(command))
  while (true) {
    for (const candidate of [
      join(directory, "dist", "core", "export.js"),
      join(directory, "lib", "pxpipe", "dist", "core", "export.js"),
    ]) {
      try {
        await access(candidate, constants.R_OK)
        return candidate
      } catch {
        continue
      }
    }

    const parent = dirname(directory)
    if (parent === directory) return
    directory = parent
  }
}

function isExportModule(value: unknown): value is ExportModule {
  if (typeof value !== "object" || value === null) return false
  const module = value as Record<string, unknown>
  return (
    typeof module.DEFAULT_EXPORT_COLS === "number" &&
    typeof module.DEFAULT_EXPORT_MODEL === "string" &&
    typeof module.runExportCore === "function"
  )
}

async function loadExportModule(command: string) {
  const modulePath = await findExportModule(command)
  if (!modulePath) return
  const module: unknown = await import(pathToFileURL(modulePath).href)
  return isExportModule(module) ? module : undefined
}

async function runPxpipe(executable: string, args: string[], stdin?: string) {
  return await new Promise<string>((resolveOutput, reject) => {
    const child = spawn(executable, args, {
      stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let outputBytes = 0
    if (!child.stdout || !child.stderr || (stdin !== undefined && !child.stdin)) {
      child.kill()
      reject(new Error("pxpipe process streams are unavailable"))
      return
    }

    const timeout = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`pxpipe timed out after ${PROCESS_TIMEOUT_MS}ms`))
    }, PROCESS_TIMEOUT_MS)
    timeout.unref()

    const capture = (chunks: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.length
      if (outputBytes <= MAX_PROCESS_OUTPUT_BYTES) {
        chunks.push(chunk)
        return
      }
      child.kill("SIGKILL")
      reject(new Error(`pxpipe output exceeded ${MAX_PROCESS_OUTPUT_BYTES} bytes`))
    }

    child.stdout.on("data", (chunk: Buffer) => capture(stdout, chunk))
    child.stderr.on("data", (chunk: Buffer) => capture(stderr, chunk))
    child.once("error", reject)
    child.once("close", (code) => {
      clearTimeout(timeout)
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

  const [factsheet, prompt, pages, manifest] = await Promise.all([
    readFile(join(directory, "factsheet.txt"), "utf8"),
    readFile(join(directory, "prompt.txt"), "utf8"),
    Promise.all(pageNames.map((file) => readFile(join(directory, file)))),
    readFile(join(directory, "manifest.json"), "utf8").then((value): unknown => JSON.parse(value)),
  ])
  return { factsheet, pages, prompt, tokenReport: parseTokenReport(manifest) }
}

async function secureOutputDirectory(directory: string) {
  await chmod(directory, 0o700)
  const entries = await readdir(directory, { withFileTypes: true })
  await Promise.all(
    entries.filter((entry) => entry.isFile()).map((entry) => chmod(join(directory, entry.name), 0o600)),
  )
}

export class PxpipeRenderer implements ContextRenderer {
  readonly #executable: string
  readonly #useLibrary: boolean
  #library?: Promise<ExportModule | undefined>
  #libraryReady = false
  #preload: Promise<void>
  #version?: Promise<string>

  constructor(executable = "pxpipe", useLibrary = true) {
    this.#executable = executable
    this.#useLibrary = useLibrary
    if (useLibrary === false) {
      this.#preload = Promise.resolve()
      return
    }

    this.#library = loadExportModule(executable).catch(() => undefined)
    this.#preload = this.#library
      .then(async (library) => {
        if (!library) return
        await library.runExportCore("pxpipe warmup", {
          cols: library.DEFAULT_EXPORT_COLS,
          model: library.DEFAULT_EXPORT_MODEL,
          sourceFiles: [],
        })
        this.#libraryReady = true
      })
      .catch(() => undefined)
  }

  version() {
    this.#version ??= executableIdentity(this.#executable)
    return this.#version
  }

  preload() {
    return this.#preload
  }

  async #renderWithLibrary(text: string, modelID: string, temporaryRoot: string) {
    if (this.#useLibrary === false) return
    await this.#preload
    if (this.#libraryReady === false) return
    this.#library ??= loadExportModule(this.#executable)
    const library = await this.#library
    if (!library) return

    const result = await library.runExportCore(text, {
      cols: library.DEFAULT_EXPORT_COLS,
      model: modelID,
      sourceFiles: [],
    })
    const outputDirectory = join(temporaryRoot, "pxpipe-export-library")
    await mkdir(outputDirectory)
    if (result.artifacts.some((artifact) => basename(artifact.filename) !== artifact.filename)) {
      throw new Error("pxpipe library returned an unsafe artifact filename")
    }
    await Promise.all(
      result.artifacts.map((artifact) => writeFile(join(outputDirectory, artifact.filename), artifact.data)),
    )
    const factsheet = result.artifacts.find((artifact) => artifact.filename === "factsheet.txt")
    const prompt = result.artifacts.find((artifact) => artifact.filename === "prompt.txt")
    const manifest = result.artifacts.find((artifact) => artifact.filename === "manifest.json")
    const pages = result.artifacts
      .filter((artifact) => /^page-\d+\.png$/.test(artifact.filename))
      .sort((left, right) => left.filename.localeCompare(right.filename))
    if (!factsheet || !prompt || !manifest || pages.length === 0) {
      throw new Error("pxpipe library returned incomplete artifacts")
    }
    return {
      directory: outputDirectory,
      rendered: {
        factsheet: Buffer.from(factsheet.data).toString("utf8"),
        pages: pages.map((page) => Buffer.from(page.data)),
        prompt: Buffer.from(prompt.data).toString("utf8"),
        tokenReport: parseTokenReport(JSON.parse(Buffer.from(manifest.data).toString("utf8")) as unknown),
      },
    }
  }

  async #renderWithCli(text: string, modelID: string, temporaryRoot: string) {
    const output = await runPxpipe(
      this.#executable,
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
    return { directory: outputDirectory }
  }

  async render(text: string, modelID: string, cacheDirectory: string) {
    const cacheParent = dirname(cacheDirectory)
    await mkdir(cacheParent, { recursive: true })
    await chmod(cacheParent, 0o700)
    const temporaryRoot = await mkdtemp(join(cacheParent, ".staging-"))
    try {
      let output: RenderOutput | undefined
      try {
        output = await this.#renderWithLibrary(text, modelID, temporaryRoot)
      } catch {
        output = undefined
      }
      output ??= await this.#renderWithCli(text, modelID, temporaryRoot)
      await secureOutputDirectory(output.directory)

      const rendered = output.rendered ?? (await loadRenderedContext(output.directory))
      try {
        await rename(output.directory, cacheDirectory)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error
        try {
          await secureOutputDirectory(cacheDirectory)
          return await loadRenderedContext(cacheDirectory)
        } catch {
          await rm(cacheDirectory, { recursive: true, force: true })
          await rename(output.directory, cacheDirectory)
        }
      }
      return rendered
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  }
}
