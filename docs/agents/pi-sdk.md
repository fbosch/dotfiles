# Pi runtime SDK alignment

The installed Pi runtime is the source of truth for extension declarations.
The npm SDK in `.pi/agent/node_modules` can lag behind the launcher. Do not use
its version as evidence that a runtime event or method exists.

## Before editing extensions

1. Run `bun run --cwd .pi/agent sdk:sync`. It resolves the external `pi`
   launcher on PATH, ignoring package-manager `node_modules/.bin` entries,
   and prints the selected SDK version and directory.
2. Check that the printed installation is the one you intend to support.
   On Nix, the sandbox wrapper's store references identify its SDK without
   launching a nested Pi session. A long-running session can still have an old
   launcher on PATH after a system upgrade.
3. Restart the editor's TypeScript server after switching SDK installations.
   `.pi/agent/tsconfig.json` inherits generated package mappings from
   `node_modules/.cache/pi-sdk/tsconfig.json`. Both the editor and Bun use these
   mappings. Do not edit or commit the generated file.
4. Run focused tests and `bun run --cwd .pi/agent typecheck`.
   Typechecking refreshes the mappings first. `sdk:check` checks that existing
   mappings still match the selected installation without rewriting them.

Missing or ambiguous runtime SDK discovery fails rather than falling back to
the npm development SDK. For a launcher layout the resolver cannot identify,
select its installed package directory explicitly:

```bash
bun run --cwd .pi/agent sdk:sync --sdk-root /path/to/pi-coding-agent
```

Subsequent automatic sync uses PATH again. To keep an explicit target, adjust
PATH to that installation or invoke `lib/runtime-sdk.ts --sdk-root ...` before
running `tsc --noEmit` directly.

## After upgrading Pi

1. Start a fresh shell and Pi session so PATH and the running process agree.
2. Run `sdk:sync`, inspect the printed version and directory, and restart the
   editor's TypeScript server.
3. Read the installed SDK's declarations, release notes, and relevant examples.
   Nix builds include local overlays, so matching an upstream version number
   alone is insufficient.
4. Run the affected lifecycle tests and full typecheck, then `devenv test`.
   Do not cast away errors or claim successful migration while diagnostics remain.

`bun run test`, `just install-pi`, and `devenv test` synchronize SDK mappings in their
workflows. Dependency installation remains frozen; SDK selection does not
update package manifests, lockfiles, or installed dependencies.

## Event and error boundaries

- Do not copy SDK interfaces or add module augmentations to hide version drift.
  Resolve the installed declarations first. Local runtime patches must carry
  matching declarations in the runtime package.

- Narrow discriminated events before reading variant-specific fields.
  For `before_agent_start`, only `messageType === "user"` has `prompt` and
  `images`. A custom-message start has `message` instead.
- Build event fixtures with checked return types or `satisfies`, not
  `as BeforeAgentStartEvent`. Use the factories in
  `.pi/agent/extensions/shared/__tests__/agent-start-events.ts` for user and
  custom starts. Cover both variants when a handler consumes user input.
- Await or return asynchronous work when the callback contract allows it.
  Detached work needs an explicit rejection handler and an owner responsible
  for cancellation and cleanup. `void` alone does not handle rejection.
- Use typed results for expected failures. Report unexpected defects at the
  extension boundary without silently converting them into success.
  Authorization and command-approval failures must remain fail-closed.
