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

async function benchmarkColdWorker(name: string, worker: string, preloadDelayMs: number) {
  const samples: number[] = []
  for (let index = 0; index < EXTERNAL_ITERATIONS; index += 1) {
    const child = Bun.spawn([process.execPath, import.meta.path, worker, String(preloadDelayMs)], {
      stderr: "inherit",
      stdout: "pipe",
    })
    const output = await new Response(child.stdout).text()
    if ((await child.exited) !== 0) throw new Error(`${worker} benchmark worker failed`)
    samples.push(Number(output))
  }
  return summarize(name, samples)
}

function freshService(root: string, worktree: string, renderer: ContextRenderer, prefix: string, index: number) {
  return new ContextImagesService({
    cacheRoot: join(root, `${prefix}-${index}`),
    renderer,
    sources: ["AGENTS.md"],
    worktree,
  })
}

async function benchmarkStubMiss(root: string, worktree: string) {
  const samples: number[] = []
  const renderer = new CachedRenderer()
  for (let index = 0; index < FAST_ITERATIONS + FAST_WARMUP; index += 1) {
    const service = freshService(root, worktree, renderer, "stub-miss", index)
    const start = Bun.nanoseconds()
    await service.transformMessages({}, { messages: [{ info: userMessage(`miss-${index}`), parts: [] }] })
    if (index >= FAST_WARMUP) samples.push((Bun.nanoseconds() - start) / 1_000_000)
    await service.waitForRenders()
  }
  return summarize("message transform, cache miss", samples)
}

async function benchmarkBackgroundMiss(
  root: string,
  worktree: string,
  renderer: ContextRenderer,
): Promise<Benchmark[]> {
  const dispatchSamples: number[] = []
  const readySamples: number[] = []
  for (let index = 0; index < EXTERNAL_ITERATIONS + EXTERNAL_WARMUP; index += 1) {
    const service = freshService(root, worktree, renderer, "background-miss", index)
    const start = Bun.nanoseconds()
    await service.transformMessages({}, { messages: [{ info: userMessage(`background-${index}`), parts: [] }] })
    const dispatched = (Bun.nanoseconds() - start) / 1_000_000
    await service.waitForRenders()
    const ready = (Bun.nanoseconds() - start) / 1_000_000
    const parts: Part[] = []
    await service.transformMessages({}, { messages: [{ info: userMessage(`ready-${index}`), parts }] })
    if (parts.some((part) => part.type === "file") === false) throw new Error("background cache was not published")
    if (index >= EXTERNAL_WARMUP) {
      dispatchSamples.push(dispatched)
      readySamples.push(ready)
    }
  }
  return [
    summarize("pxpipe miss dispatch", dispatchSamples),
    summarize("pxpipe miss cache ready", readySamples),
  ]
}

async function benchmarkStartupWarm(root: string, worktree: string, renderer: ContextRenderer) {
  const samples: number[] = []
  for (let index = 0; index < EXTERNAL_ITERATIONS + EXTERNAL_WARMUP; index += 1) {
    const service = freshService(root, worktree, renderer, "startup-warm", index)
    const start = Bun.nanoseconds()
    await service.warmAmbient(MODEL_ID)
    if (index >= EXTERNAL_WARMUP) samples.push((Bun.nanoseconds() - start) / 1_000_000)
  }
  return summarize("startup warm, cache miss", samples)
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
      sources: ["AGENTS.md"],
      worktree,
    })
    await cached.transformMessages({}, { messages: [{ info: userMessage("prime"), parts: [] }] })
    await cached.waitForRenders()

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
      await benchmark("startup warm, cache hit", FAST_ITERATIONS, FAST_WARMUP, async () => {
        await cached.warmAmbient(MODEL_ID)
      }),
    )
    results.push(await benchmarkStubMiss(root, worktree))

    const systemService = new ContextImagesService({
      cacheRoot: join(root, "cached"),
      renderer: new CachedRenderer(),
      sources: ["AGENTS.md"],
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
          await systemService.transformSystem(
            { sessionID, model: { id: MODEL_ID, providerID: "openai" } },
            { system },
          )
        },
        async (iteration) => {
          const sessionID = `system-${iteration}`
          await systemService.transformMessages({}, { messages: [{ info: userMessage(sessionID), parts: [] }] })
        },
      ),
    )

    results.push(
      await benchmark("pxpipe identity, cold", EXTERNAL_ITERATIONS, EXTERNAL_WARMUP, async () => {
        await new PxpipeRenderer("pxpipe", false).version()
      }),
    )
    results.push(await benchmarkColdWorker("pxpipe library, first use", "--cold-library-worker", 0))
    results.push(await benchmarkColdWorker("pxpipe library, after 100ms", "--cold-library-worker", 100))
    results.push(await benchmarkColdWorker("pxpipe library, after 500ms", "--cold-library-worker", 500))
    results.push(await benchmarkColdWorker("startup first use", "--cold-startup-worker", 0))
    results.push(await benchmarkColdWorker("startup after 100ms", "--cold-startup-worker", 100))
    results.push(await benchmarkColdWorker("startup after 500ms", "--cold-startup-worker", 500))
    const libraryRenderer = new PxpipeRenderer()
    const cliRenderer = new PxpipeRenderer("pxpipe", false)
    await libraryRenderer.preload()
    results.push(await benchmarkStartupWarm(root, worktree, libraryRenderer))
    results.push(...(await benchmarkBackgroundMiss(root, worktree, libraryRenderer)))
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
    const pxpipeIdentity = await new PxpipeRenderer("pxpipe", false).version()

    console.log(`platform: ${platform()} ${release()}`)
    console.log(`cpu: ${cpus()[0]?.model ?? "unknown"}`)
    console.log(`bun: ${Bun.version}`)
    console.log(`pxpipe executable: sha256:${pxpipeIdentity.slice(0, 12)}`)
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

async function coldStartupWorker(preloadDelayMs: number) {
  const root = await mkdtemp(join(tmpdir(), "context-images-startup-bench-"))
  try {
    const worktree = join(root, "worktree")
    await mkdir(worktree)
    await writeFile(join(worktree, "AGENTS.md"), INSTRUCTIONS)
    const service = new ContextImagesService({
      cacheRoot: join(root, "cache"),
      renderer: new PxpipeRenderer(),
      sources: ["AGENTS.md"],
      worktree,
    })
    if (preloadDelayMs > 0) await Bun.sleep(preloadDelayMs)
    const start = Bun.nanoseconds()
    await service.warmAmbient(MODEL_ID, 1_000)
    process.stdout.write(String((Bun.nanoseconds() - start) / 1_000_000))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

if (process.argv[2] === "--cold-library-worker") {
  await coldLibraryWorker(Number(process.argv[3] ?? 0))
} else if (process.argv[2] === "--cold-startup-worker") {
  await coldStartupWorker(Number(process.argv[3] ?? 0))
} else {
  await main()
}
