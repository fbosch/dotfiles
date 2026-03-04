import { randomUUID } from "node:crypto"
import {
  collectDynamicMetadata,
  collectStaticMetadata,
  formatMachineContext,
  marker,
} from "./metadata"

type Part = {
  type?: string
  id?: string
  text?: string
}

type Message = {
  info?: {
    role?: string
  }
  parts: Part[]
}

type TransformOutput = {
  messages?: Message[]
}

class MachineContextService {
  staticMetadata = collectStaticMetadata()

  async transform(_input: Record<string, never>, output: TransformOutput) {
    try {
      const messages = output.messages
      if (!messages?.length) return

      const lastUser = messages.findLast((message) => message.info?.role === "user")
      if (!lastUser) return

      if (
        lastUser.parts.some(
          (part) => part.type === "text" && typeof part.text === "string" && part.text.includes(marker),
        )
      ) {
        return
      }

      const dynamicMetadata = collectDynamicMetadata()
      const text = formatMachineContext(this.staticMetadata, dynamicMetadata)

      lastUser.parts.unshift({
        type: "text",
        id: randomUUID(),
        text,
      })
    } catch {
      return
    }
  }
}

// Benchmark utilities
const time = async (fn: () => Promise<void> | void): Promise<number> => {
  const start = performance.now()
  await fn()
  return performance.now() - start
}

const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length
const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
const stdDev = (values: number[], avg: number): number => {
  const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length
  return Math.sqrt(variance)
}

// Benchmark scenarios
const scenarios = {
  noMessages: (): TransformOutput => ({
    messages: undefined,
  }),

  messagesNoUser: (): TransformOutput => ({
    messages: [
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "Hello" }],
      },
    ],
  }),

  existingMarker: (): TransformOutput => ({
    messages: [
      {
        info: { role: "user" },
        parts: [{ type: "text", text: `Some text\n${marker}\nMore text` }],
      },
    ],
  }),

  normalInject: (): TransformOutput => ({
    messages: [
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "Previous response" }],
      },
      {
        info: { role: "user" },
        parts: [{ type: "text", text: "What is the time?" }],
      },
    ],
  }),
}

// Run benchmarks
async function runBenchmark(
  name: string,
  fn: () => Promise<void> | void,
  iterations: number = 1000,
): Promise<{ name: string; mean: number; median: number; stdDev: number; min: number; max: number }> {
  const times: number[] = []

  for (let i = 0; i < iterations; i++) {
    const elapsedMs = await time(fn)
    times.push(elapsedMs * 1000)
  }

  const avg = mean(times)
  const med = median(times)
  const std = stdDev(times, avg)
  const min = Math.min(...times)
  const max = Math.max(...times)

  return { name, mean: avg, median: med, stdDev: std, min, max }
}

async function main() {
  console.log("🔬 Machine Context Plugin Benchmark\n")
  console.log("Environment:")
  console.log(`  Platform: ${process.platform}`)
  console.log(`  Node: ${process.version}`)
  console.log(`  CPUs: ${require("os").cpus().length}`)
  console.log()

  const service = new MachineContextService()

  // Warm up
  console.log("Warming up...")
  for (let i = 0; i < 100; i++) {
    await service.transform({}, scenarios.normalInject())
  }
  console.log()

  // Benchmark transform hook with different scenarios
  console.log("📊 Transform Hook Benchmarks (1000 iterations each):\n")

  const results = await Promise.all([
    runBenchmark("No messages (early return)", async () => {
      await service.transform({}, scenarios.noMessages())
    }),

    runBenchmark("Messages, no user (early return)", async () => {
      await service.transform({}, scenarios.messagesNoUser())
    }),

    runBenchmark("Existing marker (dedup path)", async () => {
      await service.transform({}, scenarios.existingMarker())
    }),

    runBenchmark("Normal inject path", async () => {
      await service.transform({}, scenarios.normalInject())
    }),
  ])

  // Print results table
  console.log("┌─────────────────────────────────────┬──────────┬──────────┬──────────┬──────────┬──────────┐")
  console.log("│ Scenario                            │ Mean (μs)│ Median   │ StdDev   │ Min      │ Max      │")
  console.log("├─────────────────────────────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤")

  for (const result of results) {
    const name = result.name.padEnd(35)
    const mean = result.mean.toFixed(3).padStart(8)
    const median = result.median.toFixed(3).padStart(8)
    const stdDev = result.stdDev.toFixed(3).padStart(8)
    const min = result.min.toFixed(3).padStart(8)
    const max = result.max.toFixed(3).padStart(8)
    console.log(`│ ${name} │ ${mean} │ ${median} │ ${stdDev} │ ${min} │ ${max} │`)
  }

  console.log("└─────────────────────────────────────┴──────────┴──────────┴──────────┴──────────┴──────────┘\n")

  // Benchmark metadata collection
  console.log("📊 Metadata Collection Benchmarks (10000 iterations each):\n")

  const metadataResults = await Promise.all([
    runBenchmark("collectStaticMetadata()", () => {
      collectStaticMetadata()
    }, 10000),

    runBenchmark("collectDynamicMetadata()", () => {
      collectDynamicMetadata()
    }, 10000),

    runBenchmark("formatMachineContext()", () => {
      const staticMeta = collectStaticMetadata()
      const dynamicMeta = collectDynamicMetadata()
      formatMachineContext(staticMeta, dynamicMeta)
    }, 10000),
  ])

  console.log("┌─────────────────────────────────────┬──────────┬──────────┬──────────┬──────────┬──────────┐")
  console.log("│ Operation                           │ Mean (μs)│ Median   │ StdDev   │ Min      │ Max      │")
  console.log("├─────────────────────────────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤")

  for (const result of metadataResults) {
    const name = result.name.padEnd(35)
    const mean = result.mean.toFixed(3).padStart(8)
    const median = result.median.toFixed(3).padStart(8)
    const stdDev = result.stdDev.toFixed(3).padStart(8)
    const min = result.min.toFixed(3).padStart(8)
    const max = result.max.toFixed(3).padStart(8)
    console.log(`│ ${name} │ ${mean} │ ${median} │ ${stdDev} │ ${min} │ ${max} │`)
  }

  console.log("└─────────────────────────────────────┴──────────┴──────────┴──────────┴──────────┴──────────┘\n")

  // Token/char footprint
  console.log("📏 Payload Analysis:\n")
  const staticMeta = collectStaticMetadata()
  const dynamicMeta = collectDynamicMetadata()
  const formatted = formatMachineContext(staticMeta, dynamicMeta)

  console.log(`  Formatted block length: ${formatted.length} characters`)
  console.log(`  Approximate tokens (4 chars/token): ${Math.ceil(formatted.length / 4)}`)
  console.log(`  Sample output:\n`)
  console.log(formatted.split("\n").map((line) => `    ${line}`).join("\n"))
  console.log()

  // Throughput estimate
  console.log("🚀 Throughput Estimate:\n")
  const normalInjectResult = results.find((r) => r.name.includes("Normal inject"))
  if (normalInjectResult) {
    const invocationsPerSec = 1_000_000 / normalInjectResult.mean
    console.log(`  Normal inject path: ${invocationsPerSec.toFixed(0)} invocations/sec`)
    console.log(`  (Based on mean latency of ${normalInjectResult.mean.toFixed(3)}μs)\n`)
  }

  console.log("✅ Benchmark complete")
}

main().catch(console.error)
