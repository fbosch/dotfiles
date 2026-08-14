# State Machines

Use XState v5 for component orchestration when behavior has meaningful
temporal states, competing modes, delayed transitions, cancellation, or async
work. Examples include submenu open/close delays, modifier-held window
switching, confirmation lifecycles, and multi-phase system operations.

Do not use a machine for static data, formatting, cache snapshots, simple
boolean presentation, or one-way event handling. Keep those as ordinary
values, services, or focused pure functions.

## Placement

Place each machine with its feature:

```text
components/start-menu/
├── index.tsx
├── machine.ts
├── controller.ts
└── __tests__/machine.test.ts
```

Do not build one global desktop machine. Create one actor per independently
interactive component or cohesive workflow. Share events between actors only
through an explicit contract when a real cross-feature interaction exists.

## Machine Contract

- Define machines with XState v5 `setup(...).createMachine(...)` for typed
  context, events, actions, guards, actors, and delays.
- Use explicit event objects with stable `type` strings. Events describe what
  happened or was requested, not which GTK method to call.
- Model mutually exclusive modes as states instead of combinations of boolean
  flags. Use nested states when a mode has its own lifecycle.
- Keep machine context serializable where practical. Do not store GTK widgets,
  GLib source IDs, Gio cancellables, subprocesses, file monitors, or signal IDs
  in machine context.
- Give actions, guards, actors, and delays stable names. This keeps machine
  definitions readable in Stately Studio and inspection output.
- Keep business and transition decisions in the machine. Keep GTK mutation,
  Hyprland requests, process spawning, filesystem access, and notifications in
  injected implementations or a feature-local controller.
- Do not hide invalid transitions with broad fallback handlers. Unhandled
  events should remain visibly unsupported unless ignoring them is part of the
  contract.

## GJS Lifecycle

- Create and start the actor from the feature controller or component
  initialization path, never at module top level.
- Subscribe once and update GTK from snapshots in the GLib main-loop process.
- Stop the actor when its owning component or application shuts down.
- The owner must also remove every GLib source, disconnect every signal, cancel
  every Gio operation, and terminate or detach every owned subprocess.
- Do not use browser, Node.js, React, or framework-specific XState adapters in
  AGS. Import only from core `xstate` unless a separate adapter is deliberately
  evaluated for GJS.
- Do not attach networked inspection or Stately Inspector to the production
  desktop process. Development inspection must be explicit and removable.

## Effects And Timers

- Prefer XState delayed transitions for behavioral timing. Keep delay values
  named in `setup({ delays })` rather than scattering GLib timers through GTK
  handlers.
- Use invoked actors for async workflows that have success, failure, and
  cancellation semantics.
- When an effect must use GLib/Gio directly, keep resource ownership in the
  controller and send completion/failure events back to the machine.
- Never assume stopping an XState actor automatically cancels Gio work or a
  subprocess; wire that cleanup explicitly.

## Testing And Visualization

- Test machine transitions with Bun beside the feature. Cover supported
  states, ignored/invalid events, delayed transitions, failures, and cleanup
  events without importing GTK.
- Keep machine configuration declarative and named so it can be opened or
  reproduced in Stately Studio for visualization and simulation.
- Use XState inspection callbacks only in development tooling. Do not make
  visualization infrastructure a runtime requirement for AGS.
- Measure AGS bundle size, startup time, and PSS when the first production
  machine is introduced; the dependency being installed is not evidence that
  its runtime cost is acceptable.
