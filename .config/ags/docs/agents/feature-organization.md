# Feature Organization

Keep a component as one file while it has no substantial feature-local
support code. Once a feature needs its own state model, controller, child
surface, policy, or tests, move the complete vertical slice into a directory
under `components/`.

Use this shape:

```text
components/start-menu/
├── index.tsx                 # GTK surface and bundled component registration
├── machine.ts               # Pure XState machine, when temporal state warrants it
├── controller.ts            # Optional actor-to-GTK/GLib effect adapter
├── actions.ts               # Feature-local policy that is not machine state
├── recent-items-menu.tsx    # Feature-local child surface
└── __tests__/
    ├── machine.test.ts
    └── actions.test.ts
```

Rules:

- Keep the public component entry at `index.tsx`; the bundled config imports
  that file explicitly.
- Colocate code used by only one feature, including tests. Do not place
  feature-local policies in `services/` merely to make them testable.
- Keep `services/` for integrations and state shared by multiple features,
  such as Hyprland IPC, profile state, app icons, and utility routing.
- Do not create empty `machine.ts`, `controller.ts`, or barrel files in
  anticipation of future complexity. Add them when the feature has that job.
- Prefer one directory per user-visible capability. Avoid generic directories
  such as `utils/`, `helpers/`, or `machines/` that separate code by technical
  layer instead of feature ownership.
- A feature directory may expose internal types directly between its files;
  export only what another feature or the bundled entry point consumes.
