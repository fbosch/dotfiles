import { describe, expect, test } from "bun:test"
import { RenderCoordinator, type RenderRequest } from "./render-coordinator"
import type { ContextImagesEvent, ContextImagesLogger } from "./logger"
import type { RenderedContext } from "./pxpipe"

const rendered: RenderedContext = {
  factsheet: "facts",
  pages: [Buffer.from("page")],
  prompt: "prompt",
}

class FakeLogger implements ContextImagesLogger {
  events: ContextImagesEvent[] = []

  async write(event: ContextImagesEvent) {
    this.events.push(event)
  }
}

function deferred() {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function request(input: { key: string; load: () => Promise<RenderedContext>; render: () => Promise<unknown> }) {
  return input satisfies RenderRequest
}

describe("RenderCoordinator", () => {
  test("deduplicates keys and queues distinct renders with bounded concurrency", async () => {
    const coordinator = new RenderCoordinator({ maxConcurrent: 2 })
    const gate = deferred()
    const published = new Set<string>()
    const starts: string[] = []
    let active = 0
    let maxActive = 0
    const makeRequest = (key: string) =>
      request({
        key,
        load: async () => {
          if (published.has(key) === false) throw new Error("cache miss")
          return rendered
        },
        render: async () => {
          starts.push(key)
          active += 1
          maxActive = Math.max(maxActive, active)
          await gate.promise
          active -= 1
          published.add(key)
        },
      })

    await Promise.all([
      coordinator.lookupOrWarm(makeRequest("first")),
      coordinator.lookupOrWarm(makeRequest("first")),
      coordinator.lookupOrWarm(makeRequest("second")),
      coordinator.lookupOrWarm(makeRequest("third")),
    ])
    await Bun.sleep(0)

    expect(starts.sort()).toEqual(["first", "second"])
    gate.resolve()
    await coordinator.drain()
    expect(await coordinator.lookupOrWarm(makeRequest("first"))).toBe(rendered)
    expect(await coordinator.lookupOrWarm(makeRequest("third"))).toBe(rendered)
    expect(starts.sort()).toEqual(["first", "second", "third"])
    expect(maxActive).toBe(2)
  })

  test("bounds pending renders and retries excess keys later", async () => {
    const coordinator = new RenderCoordinator({ maxConcurrent: 1, maxPending: 2 })
    const gate = deferred()
    const published = new Set<string>()
    const starts: string[] = []
    const makeRequest = (key: string) =>
      request({
        key,
        load: async () => {
          if (published.has(key) === false) throw new Error("cache miss")
          return rendered
        },
        render: async () => {
          starts.push(key)
          await gate.promise
          published.add(key)
        },
      })

    await Promise.all(["first", "second", "third", "fourth"].map((key) => coordinator.lookupOrWarm(makeRequest(key))))
    await Bun.sleep(0)
    expect(starts).toEqual(["first"])

    gate.resolve()
    await coordinator.drain()
    expect(starts).toEqual(["first", "second"])

    await Promise.all(["third", "fourth"].map((key) => coordinator.lookupOrWarm(makeRequest(key))))
    await coordinator.drain()
    expect(starts).toEqual(["first", "second", "third", "fourth"])
  })

  test("validates publication, logs failures, and retries after cleanup", async () => {
    const logger = new FakeLogger()
    const coordinator = new RenderCoordinator({ logger })
    let valid = false
    let renders = 0
    const renderRequest = request({
      key: "context",
      load: async () => {
        if (valid === false) throw new Error("incomplete cache")
        return rendered
      },
      render: async () => {
        renders += 1
        if (renders === 2) valid = true
      },
    })

    expect(await coordinator.lookupOrWarm(renderRequest)).toBeUndefined()
    await coordinator.drain()
    expect(logger.events).toEqual([{ event: "transform_failed", message: "incomplete cache" }])

    expect(await coordinator.lookupOrWarm(renderRequest)).toBeUndefined()
    await coordinator.drain()
    expect(await coordinator.lookupOrWarm(renderRequest)).toBe(rendered)
    expect(renders).toBe(2)
  })

  test("bounds startup waiting and drains work not yet scheduled at timeout", async () => {
    const coordinator = new RenderCoordinator()
    const gate = deferred()
    const published = new Set<string>()
    let completed = false

    const start = Bun.nanoseconds()
    await coordinator.startup(async () => {
      await gate.promise
      await coordinator.lookupOrWarm({
        key: "startup",
        load: async () => {
          if (published.has("startup") === false) throw new Error("cache miss")
          return rendered
        },
        render: async () => {
          published.add("startup")
          completed = true
        },
      })
    }, 5)

    expect((Bun.nanoseconds() - start) / 1_000_000).toBeLessThan(100)
    expect(completed).toBe(false)
    let drained = false
    const drain = coordinator.drain().then(() => {
      drained = true
    })
    await Bun.sleep(0)
    expect(drained).toBe(false)

    gate.resolve()
    await drain
    expect(completed).toBe(true)
  })

  test("propagates startup failures completed before the timeout", async () => {
    const coordinator = new RenderCoordinator()

    await expect(
      coordinator.startup(async () => {
        throw new Error("source discovery failed")
      }, 100),
    ).rejects.toThrow("source discovery failed")
  })
})
