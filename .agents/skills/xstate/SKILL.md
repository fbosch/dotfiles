---
name: xstate
description: Build, refactor, review, debug, test, or migrate XState state machines and actor systems in JavaScript or TypeScript. Use whenever a repository imports `xstate`, `@xstate/react`, `@xstate/vue`, `@xstate/svelte`, or `@xstate/solid`, or when work involves statecharts, actors, invoke/spawn, machine context, guards, actions, persistence, inspection, or XState model-based testing. Apply stable XState v5 guidance by default; treat XState v6 as alpha unless the project explicitly installs it.
---

# XState

Use XState v5 as the default. Confirm the installed version before relying on version-specific APIs; do not introduce `xstate@alpha` or v6 patterns unless the task explicitly requires the alpha.

## Start With The Model

1. Read the machine and its actor creation sites before changing it. Identify states, events, context, input, output, child actors, and external effects.
2. Model mutually exclusive modes as states. Keep extended, non-exclusive data in context.
3. Name events as domain facts or user intents, such as `form.submitted` or `retry.requested`; do not expose implementation details in event names.
4. Keep machine configuration declarative. Register environment-dependent implementations through `setup(...)` and override them with `machine.provide(...)` for tests or alternate runtimes.
5. Follow existing project machine boundaries and event naming before creating abstractions or shared actors.

## Default Machine Pattern

Prefer `setup({...}).createMachine({...})` for TypeScript machines. Declare context and event types, then register named actions, guards, actors, and delays in `setup`.

```ts
import { assign, fromPromise, setup } from 'xstate';

const requestMachine = setup({
  types: {
    context: {} as { result?: string; error?: string },
    events: {} as { type: 'request.sent' } | { type: 'retry.requested' },
  },
  actors: {
    loadResult: fromPromise(async () => fetchResult()),
  },
}).createMachine({
  id: 'request',
  initial: 'idle',
  context: {},
  states: {
    idle: {
      on: { 'request.sent': 'loading' },
    },
    loading: {
      invoke: {
        src: 'loadResult',
        onDone: {
          target: 'success',
          actions: assign({ result: ({ event }) => event.output }),
        },
        onError: {
          target: 'failure',
          actions: assign({ error: ({ event }) => String(event.error) }),
        },
      },
    },
    success: {},
    failure: {
      on: { 'retry.requested': 'loading' },
    },
  },
});
```

Use a bare `createMachine(...)` only when the machine is truly small and local. Prefer named action and guard objects with typed `params` over inline closures when implementations are reused, need testing seams, or are part of visualized logic.

## Actors And Lifecycle

- Treat a machine as actor logic and `createActor(machine)` as a running, independent instance.
- Create an actor, subscribe if observation is needed, call `start()`, then send events. Stop root actors when their owner is disposed; this stops their descendant system too.
- Read the current state with `actor.getSnapshot()`. A late `subscribe(...)` does not replay the current snapshot.
- Use `input` for actor initialization only. Send an event when new data must change a running actor; changed UI props do not reconfigure an existing actor.
- Use actor `output` only after it reaches `status === 'done'`. A top-level final state stops the machine and prevents later events.
- Use `waitFor(...)` for an asynchronous snapshot condition and `toPromise(...)` when completion output is the API boundary.

### Choose Child Actor Lifetime Deliberately

- Use `invoke` for a known task whose lifetime belongs to a state, such as a request while loading. It starts on entry and stops on exit.
- Use `spawnChild(...)` for dynamic entities that outlive individual state transitions. Stop them explicitly or stop their parent.
- Use the `spawn` helper inside `assign(...)` only when the actor reference must be stored in context. Clear that reference when stopping the child.
- Pass `AbortSignal` from `fromPromise(...)` to cancellable APIs. Stopping a promise actor otherwise discards its result without necessarily aborting underlying work.
- Use `fromCallback(...)` for long-lived event integrations and always return cleanup. It cannot be `async`, does not produce completion output, and must report internally caught promise failures to its parent explicitly.

## Transitions, Data, And Effects

- Update context with `assign(...)`; never mutate context directly. Use a lazy context initializer when each actor needs a fresh object or input-derived context.
- Keep guards pure and synchronous. They may run during transition selection and `snapshot.can(event)`.
- Use an action for fire-and-forget work. Async actions are not awaited; represent awaited, cancellable, or failure-reporting work as actors instead.
- Place built-in action creators such as `assign(...)`, `raise(...)`, and `sendTo(...)` in machine configuration or `enqueueActions(...)`. Calling them inside a normal action implementation has no effect.
- Prefer tags and `snapshot.hasTag(...)` for behavior-oriented UI conditions that should survive state hierarchy refactors.

### Preserve Or Reenter Intentionally

- Omit `target` for an event that only updates context or runs effects. Nested state and invoked children remain active.
- An explicit target back to the same compound state resolves its initial child but does not rerun the parent by default.
- Add `reenter: true` only when exit and entry work, including invoked actors, must restart.
- Treat `always` states as transient: their actions run, but ordinary subscribers do not observe intermediate snapshots. Use inspection microsteps for tracing, or a zero-delay `after` transition when an observable intermediate state is required.

## TypeScript

- Require TypeScript 5 or newer. Prefer `strictNullChecks` and `skipLibCheck`.
- Type machines through `setup({ types: ... })` or the machine `types` field. Use `ActorRefFrom`, `SnapshotFrom`, and `EventFromLogic` to derive public types.
- Prefer typed dynamic action and guard parameters over coupling reusable implementations to an entire machine context or event union.
- Use `assertEvent(...)` only when an entry, exit, or invoke-input callback must narrow an event union that TypeScript cannot otherwise determine.
- Do not use v4 typegen. It is unsupported in v5.

## Persistence, Inspection, And Tests

- Persist `actor.getPersistedSnapshot()`, not its live snapshot. Restore with `createActor(logic, { snapshot })` before calling `start()`.
- Keep persisted snapshots JSON-serializable and test restoration whenever changing machine structure or versioning stored data. Restoration does not replay past actions and restarts active invocations.
- Use the root actor `inspect` option to trace an entire system. Inspect `@xstate.microstep` events when debugging transient states; use `@xstate.event` to trace actor communication.
- Test a machine by starting an actor, sending domain events, and asserting the resulting snapshot, context, output, and visible effects.
- Use `machine.provide(...)` to replace external actors and effects with deterministic implementations in tests.
- Import graph/model-based tools from `xstate/graph`. Do not add deprecated standalone `@xstate/graph` or `@xstate/test` packages.
- Use `initialTransition(...)` and `transition(...)` for pure transition tests. Do not start an actor merely to test state selection when no effects or lifecycle behavior are relevant.

## Version Boundary

Do not apply these v6-alpha patterns to a v5 project:

- `createAsyncLogic(...)` instead of v5 `fromPromise(...)`
- Runtime schemas in place of v5 `setup({ types: ... })`
- Action functions that return context or enqueue effects directly
- v6 deprecation of framework `useMachine(...)`

For v5 migrations, prefer `createActor(...)` over v4 `interpret(...)`, `guard` over `cond`, `machine.provide(...)` over `withConfig(...)`, actor `input` over `withContext(...)`, and `sendTo(...)` or `raise(...)` over v4 `send(...)`.
