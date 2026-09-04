import { Effect, Exit, Schedule, Scope } from "effect";

function fromPromise<Value>(promise: PromiseLike<Value>): Effect.Effect<Value, unknown> {
  return Effect.tryPromise({
    catch: (cause) => cause,
    try: () => promise,
  });
}

export function runWithTimeout<Value>(
  promise: PromiseLike<Value>,
  message: string,
  timeoutMs: number,
): Promise<Value> {
  return Effect.runPromise(
    fromPromise(promise).pipe(
      Effect.timeoutOrElse({
        duration: timeoutMs,
        orElse: () => Effect.fail(new Error(message)),
      }),
    ),
  );
}

export function repeatPromiseWhile<Value>(
  operation: () => PromiseLike<Value>,
  shouldRepeat: (value: Value) => boolean,
  options: { readonly delayMs: number; readonly maxAttempts: number },
): Promise<Value> {
  if (options.maxAttempts < 1) {
    return Promise.reject(new Error("Effect repetition requires at least one attempt"));
  }
  return Effect.runPromise(
    Effect.tryPromise({
      catch: (cause) => cause,
      try: operation,
    }).pipe(
      Effect.repeat({
        schedule: Schedule.spaced(options.delayMs),
        times: options.maxAttempts - 1,
        while: shouldRepeat,
      }),
    ),
  );
}

export class NeovimEffectScope {
  readonly #scope = Effect.runSync(Scope.make());
  #closePromise: Promise<void> | undefined;

  acquire<Value>(
    acquire: () => PromiseLike<Value>,
    release: (value: Value) => PromiseLike<void>,
  ): Promise<Value> {
    return Effect.runPromise(
      Effect.acquireRelease(Effect.tryPromise({ catch: (cause) => cause, try: acquire }), (value) =>
        Effect.promise(() => Promise.resolve(release(value)).catch(() => undefined)),
      ).pipe(Scope.provide(this.#scope)),
    );
  }

  close(): Promise<void> {
    this.#closePromise ??= Effect.runPromise(Scope.close(this.#scope, Exit.succeed(undefined)));
    return this.#closePromise;
  }
}
