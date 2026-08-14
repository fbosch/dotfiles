---
name: xstate
description: Build, refactor, review, debug, test, or migrate XState state machines, actor systems, and `@xstate/store` state management in JavaScript or TypeScript. Use whenever a repository imports `xstate`, a core framework adapter such as `@xstate/react`, or any `@xstate/store*` package, or when work involves statecharts, actors, invoke/spawn, machine context, Store context, guards, actions, persistence, inspection, selectors, or XState model-based testing. Apply stable XState v5 guidance by default; treat XState v6 as alpha unless the project explicitly installs it.
---

# XState

Use XState v5 as the default. Confirm the installed version before relying on version-specific APIs; do not introduce `xstate@alpha` or v6 patterns unless the task explicitly requires the alpha.

## Choose The Package Family

- Use core `xstate` for explicit modes, statecharts, actors, effects, invocation, spawning, and machine output.
- Use `@xstate/store` for small event-based context state without statechart modes or actor lifecycles.
- Do not implement Store behavior with machine-only APIs, or machine behavior with Store-only APIs. They are separate packages with different snapshots, selectors, effects, and persistence contracts.

## Start With The Model

1. Read the machine and its actor creation sites before changing it. Identify states, events, context, input, output, child actors, and external effects.
2. Model mutually exclusive modes as states. Keep extended, non-exclusive data in context.
3. Name events as domain facts or user intents, such as `form.submitted` or `retry.requested`; do not expose implementation details in event names.
4. Keep machine configuration declarative. Register environment-dependent implementations through `setup(...)` and override them with `machine.provide(...)` for tests or alternate runtimes.
5. Follow existing project machine boundaries and event naming before creating abstractions or shared actors.

## Route The Work

| Task | Default approach |
| --- | --- |
| Simple event-based context with no explicit modes or actors | Use `@xstate/store`; load `references/xstate-store.md` before editing. |
| Request or other work tied to one state | Invoke a `fromPromise(...)` actor in that state and handle `onDone` and `onError`. |
| Dynamic, independently-lived entity | Spawn a child actor and stop it explicitly when it is no longer needed. |
| Component-owned actor | Use the framework adapter's `useActor(...)` or `useMachine(...)` so its lifecycle follows the component. |
| Long-lived or shared UI actor | Create or own it above transient components, then pass its actor reference down. |
| UI reads one part of state | Load `references/framework-adapters.md` and use the selector API for the installed core or Store adapter. |
| State-only behavior test | Use `initialTransition(...)` and `transition(...)` without starting an actor. |
| Persisted actor | Store `getPersistedSnapshot()` and restore through the actor's `snapshot` option before starting it. |

For framework-specific hook names and return shapes, verify the installed adapter's version and follow existing project usage.

## Default Machine Pattern

Prefer `setup({...}).createMachine({...})` for TypeScript machines. Declare context and event types, then register named actions, guards, actors, and delays in `setup`.

```ts
import { assign, createActor, setup } from 'xstate';

const counterMachine = setup({
  types: {
    context: {} as { count: number },
    events: {} as { type: 'count.incremented' },
  },
}).createMachine({
  context: { count: 0 },
  on: {
    'count.incremented': {
      actions: assign({
        count: ({ context }) => context.count + 1,
      }),
    },
  },
});

const counterActor = createActor(counterMachine).start();
counterActor.send({ type: 'count.incremented' });
```

For state-scoped asynchronous work, register it in `setup({ actors: ... })` and invoke it from the state:

```ts
import { fromPromise, setup } from 'xstate';

const machine = setup({
  actors: {
    loadUser: fromPromise<{ name: string }, { userId: string }>(
      async ({ input }) => {
        const response = await fetch(`/api/users/${input.userId}`);

        if (response.ok === false) {
          throw new Error(`Unable to load user: ${response.status}`);
        }

        return response.json();
      },
    ),
  },
}).createMachine({
  initial: 'loading',
  states: {
    loading: {
      invoke: {
        src: 'loadUser',
        input: { userId: '42' },
        onDone: { target: 'success' },
        onError: { target: 'failure' },
      },
    },
    success: {},
    failure: {},
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

- Update context with `assign(...)`. Use a lazy context initializer when each actor needs a fresh object or input-derived context.
- Keep guards pure and synchronous. They may run during transition selection and `snapshot.can(event)`.
- Use an action for fire-and-forget work. Async actions are not awaited; represent awaited, cancellable, or failure-reporting work as actors instead.
- Place built-in action creators such as `assign(...)`, `raise(...)`, and `sendTo(...)` in machine configuration or `enqueueActions(...)`. Calling them inside a normal action implementation has no effect.
- Prefer tags and `snapshot.hasTag(...)` for behavior-oriented UI conditions that should survive state hierarchy refactors.

### Preserve Or Reenter Intentionally

- Omit `target` for an event that only updates context or runs effects. Nested state and invoked children remain active.
- An explicit target back to the same compound state resolves its initial child but does not rerun the parent by default.
- Add `reenter: true` only when exit and entry work, including invoked actors, must restart.
- Treat `always` states as transient: their actions run, but ordinary subscribers do not observe intermediate snapshots. Use inspection microsteps for tracing, or a zero-delay `after` transition when an observable intermediate state is required.

## Never Do These

- Never mutate context directly. Initial context objects can be shared by actors, so mutation can leak state between independent instances.
- Never await an action or put awaited work in an `async` action. XState does not await actions; invoke an actor when completion, cancellation, or errors affect behavior.
- Never use a targetless transition when it must reset nested state or restart an invocation. Use an explicit target with `reenter: true` only when that restart is intentional.
- Never use `always` for a UI-visible intermediate state. Subscribers only see the settled snapshot; use an `after` transition when the intermediate state must be observable.
- Never retain a stopped spawned actor reference in context. Clear it when stopping the child to avoid sending to a stale actor or retaining it unnecessarily.
- Never copy v6 alpha patterns into a v5 project. Verify the installed package before using version-sensitive APIs.

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

## Verify Version-Sensitive Work

Before adding or changing an unfamiliar XState API, check the installed `xstate` and framework-adapter versions, then confirm the behavior in the official stable documentation and local type definitions. The v5 docs and v6-alpha docs intentionally describe different APIs.

## Load References As Needed

- Before editing `@xstate/store` or any `@xstate/store-*` adapter, read `references/xstate-store.md`.
- Before editing a core framework adapter such as `@xstate/react`, read the relevant section in `references/framework-adapters.md`.
- Do not load either reference for backend-only core machine work that does not use Store or a framework adapter.

## Version Boundary

Do not apply these v6-alpha patterns to a v5 project:

- `createAsyncLogic(...)` instead of v5 `fromPromise(...)`
- Runtime schemas in place of v5 `setup({ types: ... })`
- Action functions that return context or enqueue effects directly
- v6 deprecation of framework `useMachine(...)`

For v5 migrations, prefer `createActor(...)` over v4 `interpret(...)`, `guard` over `cond`, `machine.provide(...)` over `withConfig(...)`, actor `input` over `withContext(...)`, and `sendTo(...)` or `raise(...)` over v4 `send(...)`.
