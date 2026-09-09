# XState Store

Use this reference for `@xstate/store` and its framework adapters. Store is not a smaller spelling of a core machine: it is a separate event-based context store without statechart modes, invoked actors, or actor hierarchies.

## Core Store Pattern

Create a store with one config object. Handle events by returning the next context.

```ts
import { createStore } from '@xstate/store';

const counterStore = createStore({
  context: { count: 0 },
  on: {
    incremented: (context) => ({
      count: context.count + 1,
    }),
  },
});

counterStore.send({ type: 'incremented' });
counterStore.subscribe((snapshot) => console.log(snapshot.context));
```

- Use `store.send(event)` for generic event dispatch. Generated helpers such as `store.trigger.incremented()` are available when the event name is statically known.
- Read the latest snapshot with `store.getSnapshot()`; use `store.get()` only where the installed version documents its tracked-read semantics.
- Return `undefined` from a handler only when the event should make no update. Otherwise return a new context object; use Immer deliberately when mutation syntax is needed.
- Keep event handlers synchronous. Use the Store enqueue effect API when the installed version supports it, or model asynchronous work at the application boundary and then send a success or failure event with its result.

## Selectors And Reuse

- Use `store.select((context) => value)` for a reactive selection outside a framework.
- Some versions expose `createStoreLogic(...)` or `fromStore(...)` for reusable logic. Check the installed package before selecting either API; do not infer their compatibility from migration examples.
- Framework `useSelector(...)` functions select from a Store **snapshot**, so access store data through `snapshot.context` there. Core `store.select(...)` functions select from the context directly.

## Schemas And Effects

- Declare `schemas.context`, `schemas.events`, and `schemas.emitted` when runtime contracts or inferred event types are useful.
- Schema declarations alone do not establish runtime validation. Opt in with `validateSchemas()` from `@xstate/store/validate` when validation is required by the task.
- Emit Store events through the supplied enqueue API and listen with `store.on(...)`. Verify exact enqueue names against the installed version.

## Framework Adapters

| Adapter | Selection behavior |
| --- | --- |
| `@xstate/store-react` | `useSelector(store, selector?, compare?)` rerenders when the selected value changes. `useStore(...)` owns a component-scoped stable store. |
| `@xstate/store-vue` | `useSelector(store, selector?)` returns a Vue-reactive selection. |
| `@xstate/store-svelte` | `useSelector(store, selector?)` returns a Svelte store, consumed with `$value`. |
| `@xstate/store-solid` | `useSelector(store, selector)` returns a Solid accessor, read with `value()`. |

Check the installed adapter before relying on optional selector or comparison arguments.

## Never Mix These Contracts

- Never use machine `invoke`, `spawnChild`, `assign`, `onDone`, or state-node configuration in a Store definition.
- Never assume `store.getSnapshot()` is a persistence format. Confirm the installed Store persistence API before adding storage or restoration.
- Never import old adapter paths such as `@xstate/store/react`; use the current package-style adapter names such as `@xstate/store-react`.
- Never treat a Store context handler as an actor action. Return the next context or intentionally return `undefined`.
