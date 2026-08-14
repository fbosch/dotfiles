# Framework Adapters

Use this reference only for UI-framework integrations. First choose the package family: core adapters consume actors and machines; Store adapters consume `@xstate/store` instances.

## Core Actor Ownership

- Let a component own an actor only when the actor should stop with that component.
- Put application, route, or shared actors above transient UI components and pass their actor references down.
- Use the installed adapter's selector API for rendering a narrow slice of an existing actor. Do not subscribe a component to a full snapshot when it only needs one stable value.
- Verify hook names and return shapes against the installed adapter. The adapters intentionally follow each framework's reactive conventions.

| Adapter | Core guidance |
| --- | --- |
| `@xstate/react` | Use `useActor(...)` or `useMachine(...)` for component-owned logic. Use `useActorRef(...)` when a stable actor reference is needed without rerendering for every snapshot, and use the adapter selector API for selected reads. |
| `@xstate/vue` | Use the composition functions for component-owned logic and selected actor reads. Keep shared actor refs outside components that should not control their lifetime. |
| `@xstate/svelte` | Use the Svelte integration's stores for snapshots and selected actor data. Do not copy v4 string-event or legacy store examples into v5 code. |
| `@xstate/solid` | `useActor(...)` owns and starts an actor for the component lifetime. `useActorRef(...)` returns a stable actor reference without subscribing the component to snapshots. Use `fromActorRef(...)` for an externally owned actor. |

## Store Adapters

For `@xstate/store-react`, `@xstate/store-vue`, `@xstate/store-svelte`, or `@xstate/store-solid`, read `xstate-store.md`. Their `useSelector(...)` APIs select Store snapshots, not core actor snapshots.

## Never Blur Ownership

- Never create a component-local actor for application-wide state just because a hook is convenient. Its lifetime becomes coupled to mounting and unmounting.
- Never pass a component-owned actor reference to code that outlives the component without defining who stops it.
- Never transfer hook signatures between React, Vue, Svelte, and Solid. Match the installed adapter and the project's established usage.
