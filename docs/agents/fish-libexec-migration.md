# Fish libexec Migration Backlog

Keep Fish functions user-facing and move dense parsing/transformation logic into Bun/TypeScript helpers under `.config/fish/libexec/`.

## Scope and Principles

- Fish (`.config/fish/functions/*.fish`) owns: CLI UX, prompts, `gum` interactions, command orchestration.
- libexec (`.config/fish/libexec/*.ts`) owns: parsing, transforms, cache/data modeling, deterministic output.
- Helper contracts should be stable: explicit args, stdout for result, stderr for errors, non-zero exit on failure.

## Phase 1: Quick Wins (Low Risk)

### 1) `flake_check_updates.fish` -> `flake_check_updates.ts`

- [x] Extract lock/input scan and update JSON construction engine from `.config/fish/functions/flake_check_updates.fish`.
- [x] Keep fish wrapper behavior/output unchanged.
- [ ] Acceptance criteria:
  - [x] `flake_check_updates` prints same JSON schema as before.
  - [x] Non-update path returns `{"count":0,"updates":[]}` (or current equivalent behavior).
  - [x] Helper exits non-zero on hard command failures.

### 2) `__workitems_extract.fish` -> `workitems_extract.ts`

- [ ] Extract commit/branch/workitem parsing and dedupe from `.config/fish/functions/__workitems_extract.fish`.
- [ ] Keep cache key strategy and cache semantics equivalent.
- [ ] Acceptance criteria:
  - [ ] Output records match existing callers (`workitems_on_date`, `workitems_week`).
  - [ ] Cache hit/miss behavior remains compatible.
  - [ ] Invalid date/range inputs fail with non-zero exit and useful stderr.

### 3) `ado_test_case.fish` -> `ado_test_case_helper.ts`

- [x] Extract Azure response parsing + XML steps markdown generation from `.config/fish/functions/ado_test_case.fish`.
- [x] Keep fish UX (`glow`, clipboard, user-facing prompts) intact.
- [ ] Acceptance criteria:
  - [x] Markdown output contains same sections/fields as current script.
  - [x] Missing fields degrade gracefully (no hard crash).
  - [x] `--refresh`/cache behavior preserved.

## Phase 2: Stateful/Transform Heavy

### 4) `opencode_profile_switch.fish` -> `opencode_profile_switch_apply.ts`

- [x] Extract profile comparison and config patch generation from `.config/fish/functions/opencode_profile_switch.fish`.
- [x] Keep `gum choose` flow and final status messages in fish.
- [ ] Acceptance criteria:
  - [x] Active profile detection result matches current behavior.
  - [x] Applying profile updates same keys (`model`, `small_model`, `agent.*.model`) as current jq logic.
  - [x] Unknown/missing profile returns non-zero and clear stderr.

### 5) `flake_restore.fish` -> `flake_restore_diff.ts`

- [x] Extract dependency diff/classification engine from `.config/fish/functions/flake_restore.fish`.
- [x] Keep commit picking/confirm UI in fish.
- [ ] Acceptance criteria:
  - [x] Grouping parity: upgrade/downgrade/add/remove/changed.
  - [x] Counts and displayed package names align with pre-migration output.
  - [x] Empty/no-change case remains user-friendly.

### 6) `flake_update_interactive.fish` -> `flake_update_engine.ts`

- [x] Extract cache + scan/update candidate model from `.config/fish/functions/flake_update_interactive.fish`.
- [x] Keep multi-select, confirmation, and rebuild prompts in fish.
- [ ] Acceptance criteria:
  - [x] Cache TTL and invalidation behavior stays equivalent.
  - [x] Selected updates map to same flake inputs as before.
  - [x] Rebuild fallback flow remains unchanged.

## Phase 3: High Coupling Workflows

### 7) `linear_issue_workflow.fish` -> `linear_issue_workflow_helper.ts`

- [x] Extract issue parse/enrich/cache/branch-name derivation from `.config/fish/functions/linear_issue_workflow.fish`.
- [x] Keep selection UX and worktree switching/creation in fish.
- [ ] Acceptance criteria:
  - [x] Issue list quality (state/priority labels, identifiers) remains intact.
  - [x] Branch name slugging deterministic and stable for same issue input.
  - [x] Fallback behavior when issue metadata missing remains safe.

### 8) `opencode_auth_switch.fish` -> `opencode_auth_switch_helper.ts`

- [x] Extract provider/profile model build, label mapping, and auth swap transform from `.config/fish/functions/opencode_auth_switch.fish`.
- [x] Keep confirmation UI and presentation in fish.
- [ ] Acceptance criteria:
  - [x] Correct provider/key activation after switch.
  - [x] Codex profile synchronization logic preserved.
  - [x] Countdown/usage signals still render correctly via fish wrapper.

## Do Not Migrate (For Now)

- [ ] Keep shell-native helpers in fish:
  - `.config/fish/functions/wt.fish` (`source` semantics)
  - `.config/fish/functions/wezterm_set_user_var.fish` (terminal escape behavior)
  - `.config/fish/functions/progress_bar.fish` (cursor/render control)
  - `.config/fish/functions/colors.fish` (fish env/universal var integration)

## Shared Contract Checklist (Apply To Every Migration)

- [ ] New helper has `--help` usage text.
- [ ] New helper returns stable machine-readable stdout (JSON or line format).
- [ ] Errors only to stderr; non-zero exit on failure.
- [ ] Fish wrapper remains thin: validation + UX + helper invocation.
- [ ] Add/adjust local checks:
  - [ ] `biome check .config/fish/libexec`
  - [ ] `bunx tsc -p .config/fish/libexec/tsconfig.json`
  - [ ] `fish -n` for touched fish functions

## Tracking

- [ ] Start each migration with before/after sample outputs captured in commit/PR notes.
- [ ] Migrate one function at a time unless pair is tightly coupled.
- [ ] Keep behavior parity first; optimize internals second.
