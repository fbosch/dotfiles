## Why

Profile selection currently exposes count files and overlay markers as public state. Manual selection is implemented as another counted source, so automatic Gaming can override a manually selected Power Saver mode. Consumers in Bash, LuaJIT, and AGS independently infer effective profile state, which makes policy changes unsafe and recovery state inconsistent.

The recently added profilectl fixture establishes transaction-failure coverage. The next step is to define profile policy explicitly and give every consumer one stable state contract.

## What Changes

- Make manual selection an explicit `auto`, `default`, `gaming`, or `powersave` policy setting rather than a counted source.
- Make a manual Default, Gaming, or Power Saver selection override automatic sources while retaining automatic source updates.
- Publish one atomically replaced profile state document with selection, resolved mode, and source claims.
- Make `profilectl` the sole profile-policy authority and expose an explicit CLI for setting automatic sources, manual selection, status, and reconciliation.
- Migrate AGS and LuaJIT consumers to passive reads of the canonical profile state.
- Replace profilectl's direct window-capture process matching and Window Switcher command knowledge with feature-level interfaces or state-derived behavior.
- Retain the existing UWSM, LuaJIT daemon, and feature-specific supervision architecture.

## Capabilities

### New Capabilities
- `profile-control-plane`: Defines profile selection, source precedence, transactional state publication, reconciliation, and consumer behavior.

### Modified Capabilities

- None.

## Impact

- Affected code: `.config/hypr/runtime/profiles/profilectl.sh`, profile Lua helpers, gaming watchdog, window-capture control, AGS profile consumers, and desktop recovery paths.
- Affected runtime state: `$XDG_RUNTIME_DIR/hypr-profiles` gains a canonical document; existing count and marker files become temporary compatibility projections during migration.
- Affected interfaces: profilectl commands and AGS profile-state consumption. **BREAKING:** `set-manual default` changes from clearing manual state to forcing Default; callers must use `clear-manual` for Auto before that semantic change lands.
- No new system service, framework, language runtime, or Nix dependency is introduced.
