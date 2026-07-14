import { Duration, Effect, Fiber, Option } from "effect"
import type { ContextImagesLogger } from "./logger"
import type { RenderedContext } from "./pxpipe"

export type RenderRequest = {
  key: string
  load: () => Promise<RenderedContext>
  render: () => Promise<unknown>
}

export class RenderCoordinator {
  readonly #logger?: ContextImagesLogger
  readonly #maxConcurrent: number
  readonly #maxPending: number
  readonly #renders = new Map<string, Fiber.RuntimeFiber<void, never>>()
  readonly #semaphore: Effect.Semaphore
  readonly #startups = new Set<Fiber.RuntimeFiber<void, unknown>>()

  constructor(input: { logger?: ContextImagesLogger; maxConcurrent?: number; maxPending?: number } = {}) {
    this.#logger = input.logger
    this.#maxConcurrent = input.maxConcurrent ?? 2
    this.#maxPending = input.maxPending ?? 16
    this.#semaphore = Effect.unsafeMakeSemaphore(this.#maxConcurrent)
  }

  #logFailure(error: unknown) {
    const logger = this.#logger
    if (!logger) return Effect.void
    const message = error instanceof Error ? error.message : String(error)
    return Effect.tryPromise(() => logger.write({ event: "transform_failed", message })).pipe(
      Effect.catchAll(() => Effect.void),
    )
  }

  #schedule(request: RenderRequest) {
    const existing = this.#renders.get(request.key)
    if (existing) return existing
    if (this.#renders.size >= this.#maxPending) return

    let fiber!: Fiber.RuntimeFiber<void, never>
    const render = Effect.tryPromise({
      try: async () => {
        await request.render()
        await request.load()
      },
      catch: (error) => error,
    }).pipe(
      this.#semaphore.withPermits(1),
      Effect.catchAll((error) => this.#logFailure(error)),
    )
    fiber = Effect.runFork(
      Effect.yieldNow().pipe(
        Effect.andThen(render),
        Effect.ensuring(
          Effect.sync(() => {
            if (this.#renders.get(request.key) === fiber) this.#renders.delete(request.key)
          }),
        ),
      ),
    )
    this.#renders.set(request.key, fiber)
    return fiber
  }

  async lookupOrWarm(request: RenderRequest) {
    const cached = await Effect.runPromise(
      Effect.tryPromise({ try: request.load, catch: (error) => error }).pipe(Effect.option),
    )
    if (Option.isSome(cached)) return cached.value
    this.#schedule(request)
  }

  async drain() {
    while (this.#renders.size > 0 || this.#startups.size > 0) {
      await Effect.runPromise(Fiber.awaitAll([...this.#renders.values(), ...this.#startups]))
    }
  }

  async startup(task: () => Promise<void>, timeoutMs?: number) {
    let fiber!: Fiber.RuntimeFiber<void, unknown>
    fiber = Effect.runFork(
      Effect.yieldNow().pipe(
        Effect.andThen(Effect.tryPromise({ try: task, catch: (error) => error })),
        Effect.andThen(Effect.suspend(() => Fiber.awaitAll([...this.#renders.values()])).pipe(Effect.asVoid)),
        Effect.ensuring(Effect.sync(() => this.#startups.delete(fiber))),
      ),
    )
    this.#startups.add(fiber)
    const completion = Fiber.join(fiber)
    if (timeoutMs === undefined) {
      await Effect.runPromise(completion)
      return
    }
    const completed = await Effect.runPromise(completion.pipe(Effect.timeoutOption(Duration.millis(timeoutMs))))
    if (Option.isSome(completed)) return
    Effect.runFork(completion.pipe(Effect.catchAll((error) => this.#logFailure(error))))
  }
}
