import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { cpus, platform, release, tmpdir } from "node:os"
import { join } from "node:path"
import type { Part, UserMessage } from "@opencode-ai/sdk"
import { ContextImagesService } from "./src/context-images"
import { loadRenderedContext, PxpipeRenderer, type ContextRenderer, type RenderedContext } from "./src/pxpipe"

const FAST_ITERATIONS = 50
const FAST_WARMUP = 10
const EXTERNAL_ITERATIONS = 10
const EXTERNAL_WARMUP = 1
const PAGE_BYTES = 32 * 1024
const MODEL_ID = "gpt-5.6-sol"
const INSTRUCTIONS = `${"Follow the configured project instructions precisely.\n".repeat(170)}`
const PAGE = Buffer.alloc(PAGE_BYTES, 1)
const RENDERED: RenderedContext = {
  factsheet: "AGENTS.md\nbenchmark fixture\n",
  pages: [PAGE],
  prompt: "Read the attached context image.",
}

type Benchmark = {
  iterations: number
  maxMs: number
  meanMs: number
  medianMs: number
  minMs: number
  name: string
  p95Ms: number
  standardDeviationMs: number
}

class CachedRenderer implements ContextRenderer {
  async version() {
    return "benchmark-1.0.0"
  }

  async render(_text: string, _modelID: string, cacheDirectory: string) {
    await writeRenderedContext(cacheDirectory)
    return RENDERED
  }
}

class UncachedRenderer implements ContextRenderer {
  async version() {
    return "benchmark-1.0.0"
  }

  async render() {
    return RENDERED
  }
}

function userMessage(sessionID: string): UserMessage {
  return {
    id: `message-${sessionID}`,
    sessionID,
    role: "user",
    time: { created: 1 },
    agent: "build",
    model: { providerID: "openai", modelID: MODEL_ID },
  }
}

async function writeRenderedContext(directory: string) {
  await mkdir(directory, { recursive: true })
  await Promise.all([
    writeFile(join(directory, "factsheet.txt"), RENDERED.factsheet),
    writeFile(join(directory, "prompt.txt"), RENDERED.prompt),
    writeFile(join(directory, "page-001.png"), PAGE),
  ])
}

function percentile(sorted: number[], fraction: number) {
  return sorted[Math.ceil(sorted.length * fraction) - 1]!
}

function summarize(name: string, samples: number[]): Benchmark {
  const sorted = samples.toSorted((left, right) => left - right)
  const meanMs = samples.reduce((sum, sample) => sum + sample, 0) / samples.length
  const variance = samples.reduce((sum, sample) => sum + (sample - meanMs) ** 2, 0) / samples.length
  return {
    iterations: samples.length,
    maxMs: sorted.at(-1)!,
    meanMs,
    medianMs: percentile(sorted, 0.5),
    minMs: sorted[0]!,
    name,
    p95Ms: percentile(sorted, 0.95),
    standardDeviationMs: Math.sqrt(variance),
  }
}

async function benchmark(
  name: string,
  iterations: number,
  warmup: number,
  run: (iteration: number) => Promise<void>,
  before?: (iteration: number) => Promise<void>,
): Promise<Benchmark> {
  for (let index = 0; index < warmup; index += 1) {
    await before?.(index)
    await run(index)
  }

  const samples: number[] = []
  for (let index = 0; index < iterations; index += 1) {
    const iteration = index + warmup
    await before?.(iteration)
    const start = Bun.nanoseconds()
    await run(iteration)
    samples.push((Bun.nanoseconds() - start) / 1_000_000)
  }

  return summarize(name, samples)
}

async function benchmarkColdLibrary(name: string, preloadDelayMs: number) {
  const samples: number[] = []
  for (let index = 0; index < EXTERNAL_ITERATIONS; index += 1) {
    const child = Bun.spawn([process.execPath, import.meta.path, "--cold-library-worker", String(preloadDelayMs)], {
      stderr: "inherit",
      stdout: "pipe",
    })
    const output = await new Response(child.stdout).text()
    if ((await child.exited) !== 0) throw new Error("cold library benchmark worker failed")
    samples.push(Number(output))
  }
  return summarize(name, samples)
}

function printBenchmark(result: Benchmark) {
  console.log(
    [
      result.name.padEnd(31),
      `${result.meanMs.toFixed(3).padStart(8)} ms mean`,
      `${result.medianMs.toFixed(3).padStart(8)} ms median`,
      `${result.p95Ms.toFixed(3).padStart(8)} ms p95`,
      `±${result.standardDeviationMs.toFixed(3)} ms`,
      `${result.iterations} runs`,
    ].join("  "),
  )
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "context-images-bench-"))
  try {
    const worktree = join(root, "worktree")
    const artifactDirectory = join(root, "artifact")
    await mkdir(worktree)
    await writeFile(join(worktree, "AGENTS.md"), INSTRUCTIONS)
    await writeRenderedContext(artifactDirectory)

    const cached = new ContextImagesService({
      cacheRoot: join(root, "cached"),
      renderer: new CachedRenderer(),
      worktree,
    })
    const uncached = new ContextImagesService({
      cacheRoot: join(root, "uncached"),
      renderer: new UncachedRenderer(),
      worktree,
    })
    await cached.transformMessages({}, { messages: [{ info: userMessage("prime"), parts: [] }] })

    const results: Benchmark[] = []
    results.push(
      await benchmark("load rendered context", FAST_ITERATIONS, FAST_WARMUP, async () => {
        await loadRenderedContext(artifactDirectory)
      }),
    )
    results.push(
      await benchmark("message transform, cache hit", FAST_ITERATIONS, FAST_WARMUP, async (iteration) => {
        const parts: Part[] = []
        await cached.transformMessages({}, { messages: [{ info: userMessage(`hit-${iteration}`), parts }] })
      }),
    )
    results.push(
      await benchmark("message transform, cache miss", FAST_ITERATIONS, FAST_WARMUP, async (iteration) => {
        const parts: Part[] = []
        await uncached.transformMessages({}, { messages: [{ info: userMessage(`miss-${iteration}`), parts }] })
      }),
    )

    const systemService = new ContextImagesService({
      cacheRoot: join(root, "cached"),
      renderer: new CachedRenderer(),
      worktree,
    })
    results.push(
      await benchmark(
        "system replacement",
        FAST_ITERATIONS,
        FAST_WARMUP,
        async (iteration) => {
          const sessionID = `system-${iteration}`
          const system = [`prefix\nInstructions from: ${join(worktree, "AGENTS.md")}\n${INSTRUCTIONS}\nsuffix`]
          await systemService.transformSystem({ sessionID, model: { id: MODEL_ID } }, { system })
        },
        async (iteration) => {
          const sessionID = `system-${iteration}`
          await systemService.transformMessages({}, { messages: [{ info: userMessage(sessionID), parts: [] }] })
        },
      ),
    )

    const pxpipeVersion = Bun.spawnSync(["pxpipe", "--version"]).stdout.toString().trim()
    results.push(
      await benchmark("pxpipe identity, cold", EXTERNAL_ITERATIONS, EXTERNAL_WARMUP, async () => {
        await new PxpipeRenderer("pxpipe", false).version()
      }),
    )
    results.push(await benchmarkColdLibrary("pxpipe library, first use", 0))
    results.push(await benchmarkColdLibrary("pxpipe library, after 100ms", 100))
    results.push(await benchmarkColdLibrary("pxpipe library, after 500ms", 500))
    const libraryRenderer = new PxpipeRenderer()
    const cliRenderer = new PxpipeRenderer("pxpipe", false)
    await libraryRenderer.preload()
    results.push(
      await benchmark("pxpipe library render", EXTERNAL_ITERATIONS, EXTERNAL_WARMUP, async (iteration) => {
        await libraryRenderer.render(INSTRUCTIONS, MODEL_ID, join(root, `pxpipe-library-${iteration}`))
      }),
    )
    results.push(
      await benchmark("pxpipe CLI render", EXTERNAL_ITERATIONS, EXTERNAL_WARMUP, async (iteration) => {
        await cliRenderer.render(INSTRUCTIONS, MODEL_ID, join(root, `pxpipe-cli-${iteration}`))
      }),
    )

    console.log(`platform: ${platform()} ${release()}`)
    console.log(`cpu: ${cpus()[0]?.model ?? "unknown"}`)
    console.log(`bun: ${Bun.version}`)
    console.log(`pxpipe: ${pxpipeVersion}`)
    console.log(`fixture: ${Buffer.byteLength(INSTRUCTIONS)} instruction bytes, ${PAGE_BYTES} cached PNG bytes`)
    console.log("")
    for (const result of results) printBenchmark(result)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function coldLibraryWorker(preloadDelayMs: number) {
  const root = await mkdtemp(join(tmpdir(), "context-images-cold-bench-"))
  try {
    const renderer = new PxpipeRenderer()
    if (preloadDelayMs > 0) await Bun.sleep(preloadDelayMs)
    const start = Bun.nanoseconds()
    await renderer.render(INSTRUCTIONS, MODEL_ID, join(root, "cache"))
    process.stdout.write(String((Bun.nanoseconds() - start) / 1_000_000))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

if (process.argv[2] === "--cold-library-worker") {
  await coldLibraryWorker(Number(process.argv[3] ?? 0))
} else {
  await main()
}
