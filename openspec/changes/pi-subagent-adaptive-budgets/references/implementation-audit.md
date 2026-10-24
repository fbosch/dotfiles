# Adaptive-budget implementation audit

## Baseline disposition

The user selected "Proceed with this feature; keep acceptance blocked (Recommended)". This authorizes scoped implementation and verification of `pi-subagent-adaptive-budgets` on revision `2d0f7222d956e73bb57f69b337ef30adf7e73868`.

It does not waive existing full-project failures, establish acceptance of `pi-minimal-subagents`, or resume the blocked notice-delivery goal. Failures not proven pre-existing remain unresolved, not relabeled as unrelated. Full-project and live-UI acceptance remain separate requirements.

The initial worktree contained only the untracked adaptive-budget proposal. No dependency, lockfile, commit, baseline-repair, or production automatic-enablement change is authorized by this disposition.

## Fresh scoped baseline

- `devenv tasks run test:pi-subagents` exited 0 before runtime or test changes.
- Results: 192 passed, 1 skipped, 0 failed across 27 files.
- Full command output: `/tmp/pi-adaptive-budget-baseline.log`.
- Dekit discovery and inspection resolved `devenv:test:pi-subagents`, but task registration failed without a diagnostic and status returned "Invalid dekit runner response". The established command was run directly rather than changing the workflow.

These results cover the scoped runner baseline only. Historical full-project validation remains blocked.

## Authority and data boundaries

Budget advice is optional control-plane input, not tool permission, user approval, or proof of task completion. Deterministic limits and lifecycle checks must reject stale, duplicate, over-ceiling, or ineligible grants.

Classifier requests must exclude raw prompts, transcripts, tool bodies, private paths, credentials, and unapproved worker-authored text. Loss of classifier availability preserves fixed/manual operation; loss of permission or lifecycle eligibility prevents grants.

## Acceptance status

Fixed/manual budgeting, optional advice, bounded adaptive policy, additive evidence, and inspection are implemented. The recorded evidence supports 16 of 21 tasks. Production automatic grants remain disabled. The pilot smoke could not calibrate a threshold. This is scoped implementation evidence, not full-project or live acceptance.

### Automated verification

| Check | Result | Evidence |
| --- | --- | --- |
| Development SDK 0.99.1, `devenv tasks run test:pi-subagents` | 264 passed, 1 skipped, 0 failed; 1592 assertions across 34 files | `/tmp/pi-adaptive-pilot-dev.log` |
| Installed Pi 1.3.0, same devenv workflow | 265 passed, 0 failed; 1599 assertions across 34 files | `/tmp/pi-adaptive-pilot-installed.log` |
| Pilot fixtures and scoped TypeScript, `devenv tasks run test:pi-subagent-budget-fixtures` | 13 passed, 0 failed; 65 assertions across 2 files; TypeScript exited 0 | `/tmp/pi-budget-pilot-fixtures.log` |
| `cd .pi/agent && bun run typecheck` | Exit 0 | Rerun after the pilot reader correction |
| Core changed-file Biome, preceding routed-launch verification | Exit 0; 26 files, 48 warnings, no errors | `/tmp/pi-adaptive-routed-biome.log` |
| Pilot changed-file Biome | Exit 0; 7 files, no warnings or errors | `/tmp/pi-budget-pilot-biome.log` |
| Current audit, pilot protocol, and tasks prose | 3 files checked, no warnings | `check-prose.py` |
| Strict OpenSpec validation and `git diff --check` | Exit 0 | Rerun after runtime and documentation changes |

The development skip is `installed structural tools survive pi-lens startup lazy loading` in `child-session.test.ts`. It passes in the installed-Pi workflow. This does not disposition the separate historical full-project pi-lens failure.

The installed workflow sets `PI_SUBAGENT_TEST_SDK` to `/nix/store/25bsx8r1i7fv5kj8b278x3nzbhmsfpyg-pi-1.3.0/lib/pi/node_modules/@earendil-works/pi-coding-agent/dist/index.js` and `PI_SUBAGENT_TEST_TUI` to the sibling `@earendil-works/pi-tui/dist/index.js`. Both workflows run the existing `test:pi-subagents` task, including `subagent-transcript-frame.test.ts`.

### Completed contract checks

- `1.2`: `budget-admission.test.ts` proves the awaited SDK `turn_end` boundary after completed tools, a delayed decision blocking the next request, no replay, and cancellation rejecting a late positive result. `budget-driver.test.ts` exercises the actual driver and owner on both SDKs.
- `2.1`, `2.2`, `2.3`: specialist, owner, and parent-runtime tests cover optional role ceilings, lowering-only assignment overrides, safe integers, pre-start rejection, frozen configuration, existing manual-control states, and shared launch/continuation validation. Tool schemas, the README fixture, and orchestration guidance distinguish initial allowances from ceilings.
- `3.1`, `3.2`, `3.3`: owner and budget tests cover coalesced checks, revision invalidation, preserved counters, question replies, manual extensions, release, assignment changes, shutdown, and cleanup uncertainty. Actual driver fixtures verify 16-to-20-to-24 grants, a final two-turn clamp at 22, refusal of a third grant, updated next-turn allowances, cancellation at a pending gate, partial failure evidence, and no tool replay. Native host reload tests remain in the suite. The reload route is `host.ts` session shutdown to `ParentRuntime.shutdown()`, then `WorkerDelivery.shutdown()`, then the tested `WorkerOwner.shutdown()`. Interactive acceptance remains open under `7.3`.
- `4.1`, `4.2`, `4.3`: advisor/progress tests cover inert setup, missing/disabled/unsupported configuration, auth/model failures, schema-validated outcomes, allowlisted counters, and canary/injection exclusion. Policy tests cover bounded checks, cancellation, timeout, unknown outcomes, insufficient confidence, and absent automatic readiness. Routine advice stays out of notifications; controlled setup diagnostics deduplicate by reason.
- `5.1`, `5.2`, `5.3`: history tests round-trip additive evidence, reject corrupt records, preserve older known facts, and restore read-only budgets. Driver fixtures preserve tool-result `details` while excluding their canary from advice. Metadata tests exercise widths 8, 24, and 80, unavailable metrics, advisory/applied distinctions, and inspection without classification. Existing delivery/host tests and grant-update assertions preserve attribution, freshness, and receipt ownership.
- `7.1`: the fresh automated checks above cover ordinary and enhanced operation. HEAD remains `2d0f7222d956e73bb57f69b337ef30adf7e73868`. Worktree inspection shows only scoped source, tests, instructions, and change artifacts; no dependency, lockfile, production role, or commit changes.

### Corrected findings and tooling failures

The integrated counter regression first failed because advice and decision history recorded upcoming turns 15 and 19 as used, although only 14 and 18 had completed. `budget.ts` now accepts a clearly named next-turn index and records completed turns. The regression asserts both request and persisted decision counters. Its red run is `/tmp/pi-adaptive-turn-counter-red.log`; both final suites pass the corrected assertions.

Early drafts of `budget-driver.test.ts` failed on missing persistence/cleanup dependencies, incorrect question/reply contracts, snapshot field names, and the distinction between reports and partial reports. These were corrected against the existing interfaces rather than changing production contracts. The final suites supersede those failed drafts.

Hashline rejected auto-read, stale, and wrong-owner anchors, including overlapping fragment edits. Rejected edits did not apply; fresh reads and disjoint replacements completed the changes. A premature lookup of `/tmp/pi-adaptive-driver-check.log` failed before that check could run; later checks produced the recorded logs.

Dekit again failed to register `devenv:test:pi-subagents` without a diagnostic. The established devenv command was used directly. The semantic command guard rejected oversized inline formatter commands for `driver.ts`, `owner.ts`, and `owner.test.ts`; source was instead passed as temporary input data to a short formatter command, with repository edits still applied through hashline. Complete reads follow `nextOffset`, including pages whose `truncated` flag is false. No guard was disabled. A full codemode scratch store prevented retaining verbose lint/OpenSpec output; transient copies were dropped and the OpenSpec commands rerun.

### Independent review

Read-only worker `288964bd-57d8-41b0-9d8e-529db7f12a48`, assignment `a02c700b-74ea-4bdd-97ac-7a0419db6e1f`, reviewed the four policy/advisor/history/progress modules and neighboring tests. It found no confirmed defect in that scope. It did not review driver/owner integration or run validation. The later counter finding and correction are parent-owned evidence, not part of that review's verdict.

Owner worker `f753c5fc-1e16-41e6-a8e5-6841f896f1aa`, assignment `a66ec280-8d46-42eb-8102-edf33d26c26c`, delivered the owner callbacks and lifecycle invalidation. Parent verification and the complete suites, not its handoff alone, support integration.

### Routed launch and pilot verification

Task `2.3` was reopened after the routed-launch guard rejected the new ceiling field. `production.ts` now accepts and validates `hardMaxTurns`. Production tests cover lowered valid ceilings and reject invalid, unconfigured, or over-ceiling overrides. Both SDK workflows above include those checks and restore `7.1`.

Task `6.1` now has bounded checkers and label fixtures. The 13-test pilot workflow covers exact cited facts, malformed and duplicate-key reports, identical counters with different verified usefulness, insufficient evidence, and approval/input blockers. The live smoke also verifies the corrected SDK text reader without forwarding reasoning, reports, or fixture text to budget advice.

The [six-attempt smoke artifact](runner-maintenance-pilot-2026-10-23.json) preserves the original measurement failure and the corrected trio. All corrected outputs passed, but every trial finished in two turns with no admission checkpoint. The experiment recorded 12 physical SDK requests and no classifier calls or grants. Complete worker provider-attempt counts remain unknown. It supplies no threshold, recommendation-quality estimate, adaptive comparison, or savings evidence.

The first reader incorrectly consumed serialized SDK history as visible text. The corrected reader selects text blocks from actual SDK messages and leaves full raw evidence intact. The prompt now supplies its fixture ID and blocker encoding. The retry retained the original deadline and reduced the remaining trial allowance to 23.

Direct read outcomes remained unknown under the reviewed versioned-envelope policy. Persisted tool-result details include snapshot IDs and metrics; a non-error return is not proof of task advancement. Production rollout still needs representative admission-gated evidence and reviewed outcome support.

Dekit could not register `just:pi-subagent-budget-pilot`, and its status endpoint returned an invalid runner response. The inspected Just recipe ran directly. Hashline rejected stale anchors in `subagent-budget-pilot.ts` and `subagent-budget-trial-cli.ts`; fresh reads resolved both. A raw first-run `session.json` inspection exceeded the hashline long-line limit. Later dumps use indented JSON; the original private evidence remains unchanged. The devenv workflows emitted the existing duplicate Cachix-substituter warning.

### Fresh-parent persistence acceptance

The [fresh-parent probe](fresh-parent-persistence-2026-10-23.json) reproduces a storage-acknowledgement gap with SDK 0.99.1 and installed Pi 1.3.0. Both the working-tree adapter and `history.ts` from baseline `2d0f7222d956e73bb57f69b337ef30adf7e73868` return from saving and restore `persistence: "saved"` while `fileExists: false` and `conversationMessages: 0`.

The SDK's `SessionManager._persist()` returns without writing until a user or assistant message exists. `isPersisted()` reports configured file-backed storage, not whether entries have been written. The adapter checks only that a session path is configured and that append returned. A path therefore does not establish a successful write.

Appending a user-role fixture message creates the file and retains the complete report and serialized tool-result details. This confirms later flushing, not the earlier saved acknowledgement. The probe invokes only public SessionManager and history APIs, without a model, classifier, AgentSession, or UI.

The first installed-baseline probe failed to resolve `typebox/value` in its private directory. Linking the existing project dependency tree resolved it; no dependencies changed. A full codemode scratch store prevented caching one successful result, so the rerun observations are retained in the artifact instead. Temporary probe files have no workspace static-analysis coverage.

The observations above describe the pre-repair state. The user subsequently authorized a localized acknowledgement fix, without an SDK patch or fabricated conversation. This permission does not resolve full-project acceptance or resume the notice-delivery goal.

### Authorized acknowledgement repair

`history.ts` now requires file growth around each synchronous history append before acknowledging it. Missing, non-file, or unreadable file state cannot acknowledge a write. The append still runs when the preliminary stat is unavailable, so native write errors and the SDK's in-memory evidence are preserved. Failed-marker writes remain best effort. The tool interface, saved schema, stable identifiers, permissions, and budget policy did not change.

The [post-fix probes](fresh-parent-persistence-fix-2026-10-23.json) verify both SDKs reject the save while no file exists and retain `persistence: "failed"`. Appending a user-role fixture message later writes that failure record with the complete report and serialized tool-result details. The original attempt remains failed rather than becoming a false success.

Three neighboring regressions cover fresh-parent buffering and later flushing, subsequent successful work, an existing-but-unwritten path, and an unwritten saved marker. They also check complete tool details and budget evidence. The tests await confirmed owner shutdown before reading storage status; assignment completion alone can precede persistence settlement. The budget-history fixture now writes and restores an actual file.

- Threat boundary: the trusted SDK appender and its parent-session file. A false saved acknowledgement creates a medium-severity evidence-loss risk; this fix does not add authentication or isolation.
- Mitigation: fail closed when synchronous file growth cannot be confirmed, while retaining buffered evidence and original write failures.
- Verification: the corrected red workflow had 264 passes, 1 skip, and the 3 intended failures. The final development workflow has 267 passes and 1 skip; installed Pi 1.3.0 has 268 passes. Typecheck and changed-file Biome pass.
- Residual risk: confirmation assumes the SDK's synchronous, single-writer JSONL path. File growth is not fsync-level crash durability or protection against hostile concurrent writers.

Dekit registration for `devenv:test:pi-subagents` failed, so the discovered `devenv tasks run test:pi-subagents` workflow ran directly. Stale/foreign hashline anchors and one overlapping import edit required fresh reads before completion. Initial test-ordering and Biome failures were corrected; final checks passed. Private logs and probe scripts remain under `/tmp/pi-parent-persistence.zqyWB3/`.

No new calibration trials ran and no automatic-grant settings changed. The fresh-parent storage check is complete, not live/UI acceptance. Task `7.3`, the full-project gate, and the notice-delivery goal remain incomplete. The extension still requires `/reload` in the running parent.

### Follow-up at `c7817a2c9c7af776dfa33d5ac8f250fd60c670e1`

The follow-up began from that clean HEAD. The user approved replacing the invalid manual pilot reference with a scripted admission reference. No production role, permission, dependency, lockfile, or automatic-enablement setting changed.

The old reference called `extendBudget()` while its worker was running, a state the public manual-control contract rejects. The benchmark now uses a fixture-only probability-one oracle through the existing admission policy. It does not dispatch a real classifier. The evidence gate and eight-turn ceiling still apply. Version-two reports record granted `referenceTurns`; unextended references are unscorable. The saved version-one smoke remains unchanged.

The fake-driver owner regression verifies running admission, the unchanged manual-extension rejection, one four-turn increment, refusal beyond eight turns, and no classifier dispatch. Other cases preserve fixed/advisory behavior, unknown-only rejection, and the repeated-failure gate. These are offline owner/policy checks, not a measured live calibration run.

- `devenv tasks run test:pi-subagent-budget-fixtures`: 18 passed, 0 failed, 107 assertions across 3 files; scoped TypeScript exited 0. Evidence: `/tmp/pi-budget-reference-final.EUFTFU/workflow.log`.
- Changed-file Biome exited 0 for four files. Evidence: `/tmp/pi-budget-reference-final-lint.sxCn3o/biome.log`. An initial import-wrapping error was corrected.
- Global `bun run typecheck` exited 0. Evidence: `/tmp/pi-budget-reference-checks.FSsEOO/typecheck.log`.
- Pilot protocol prose, strict OpenSpec validation, and the source diff check exited 0. The audit itself is checked separately after this update.
- Dekit registration failed for `devenv:test:pi-subagent-budget-fixtures` without a diagnostic. The discovered devenv command ran directly. No new calibration trials ran and no trial deadline was reset.

#### Fresh full-project failure

A read-only `devenv test` pass on the clean pre-edit HEAD exited 1. Its `test:pi-extensions` summary records 2481 passed, 34 failed, 8 skipped, and 1 error; 2523 tests across 260 files with 15449 assertions. The parent verified that summary in the retained log. Other task totals remain unknown where terminal output was interleaved.

Explicitly visible failed tasks include `test:ags-gjs`, `test:fish-greeting`, `test:skill-suggestions-eval`, `test:nvim-dekit-terminal`, `test:pi-mcp`, `test:stow`, `test:runtime-shell`, `test:pi-extensions`, and dependency-failed `test:all`. Cohorts include unavailable `ags` and `fc-match`, MCP expectation mismatches, two skill-suggestion assertions, the pi-lens patch mismatch, hashline package/image failures, CLI fixture setup failures, staged Git context, and other runtime assertions. These failures are not proven to pre-date the original migration, and no exception was accepted.

Full output is `/var/folders/2p/9hk4b2yx0wdckt43n_4g2wbc0000gn/T/openspec-7.2-validation.APTSn2/devenv-test.log`; `exit-code.txt` and `environment.txt` are beside it. The observed tools were devenv 2.4.0 on aarch64-darwin and Bun 1.4.2. The full run left the worktree clean before the reference repair.

The narrower diagnostic command `devenv shell -- bash -c 'cd .pi/agent && bun test extensions/skill-discovery/__tests__/mid-task-runtime.test.ts'` also exited 1. It reached the sandbox and reported unknown provider `mid-task-fixture` plus denied paths, rather than reproducing the full pass's missing-module message. The launcher module exists in the repository. The causes must not be conflated. Evidence: `/tmp/pi-cli-fixture-red.kb0omk/test.log`. No launcher or sandbox changes were made.

The user subsequently directed the SDK fixture to run with `--no-sandbox`. Pinning the absolute system `pi` had still invoked Nono, so that pinning probe was reverted. With the explicit flag first in the child arguments, all three fixture cases reached their expected model/classifier behavior. The remaining failures were report capture: the test read only stdout while the runtime report appeared on stderr. An explicit-stdout experiment did not resolve capture and was reverted without changing the fixture.

`mid-task-runtime.test.ts` now uses `spawnSync`, rejects process errors and nonzero status, and captures both output streams before applying the existing exact report and skill-body canary assertions. The targeted devenv-shell test passed all 3 cases with 12 assertions. Evidence: `/tmp/pi-cli-fixture-capture.iRJUVP/test.log`. Global typecheck and changed-file Biome exited 0; logs are under `/tmp/pi-cli-fixture-checks.3JHKBK/` and `/tmp/pi-cli-fixture-lint.i1ZmNq/`. Production launcher defaults and sandbox permissions are unchanged. Other SDK fixture cohorts and full-project acceptance are not covered by this scoped pass.

#### Live lifecycle evidence

Native worker `dbc2edb1-cf5b-44f9-a5c3-659d6341fc2c` completed background assignment `f4ff6da4-76fc-4d00-8351-695c6f9df150` in 7 of 8 turns and continuation `527386d4-f2fa-4a51-8326-cf5da390c36d` in 4 of 6 turns. Both reported saved persistence. Native release returned `state: released` and `liveSession: released`. The first complete report remained readable after release. This verifies those exercised paths only, not queue capacity, questions, cancellation, teardown/reload, classifier setup variants, animation, or visual layout.

#### Production-role readiness

The 20 checked-in global specialist definitions have initial allowances but no configured `hard_max_turns`. This worktree has no `.pi/agents` overrides. The observed initial values are:

- 6: `docs`.
- 12: `backlog-planning`, `explore`, `ideate`, `lookup`, `patterns`, `quick`, `validate`.
- 16: `benchmark`.
- 24: `adversarial`, `analyze`, `debug`, `general`, `pr-feedback`, `refactor`, `research`, `review`, `spec`, `test`, `visualizer`.

This is a configuration inventory, not workload evidence approving ceilings or automatic roles. The fixture ceiling is not a rollout default. Tasks 6.2, 6.3, 6.4, 7.2, and 7.3 remain unchecked, and the notice-delivery acceptance gate remains unresolved.

### Remaining acceptance

- `6.2`, `6.3`, `6.4` remain unchecked. The microfixture smoke did not reach admission. Representative fixed/advisory evidence, threshold review, controlled adaptive comparisons, and approved production role values are still needed. Scripted probabilities and fixture ceilings are not rollout recommendations.
- `7.2` remains blocked on full-project failure disposition and the required environment. The fresh full `devenv test` pass above failed. No exception was accepted, and failures not proven pre-existing remain unresolved.
- `7.3` remains open for live foreground/background, queue, question, cancellation/release, teardown/reload, classifier-failure, and visual acceptance. Component and native fixtures do not close that gate.
- Durable notice-delivery goal `1bafba24-970d-4655-9255-9d0fc4b3428d` was inspected and remains blocked. It was not resumed, updated, or completed.

### Follow-up: explicit mentions and missing skills

Missing selected skills no longer prevent startup. Resolution skips absent catalog entries or missing files, and child startup tolerates SDK omissions. The child catalog retains only selected names with matching paths; a mismatched SDK result cannot substitute another skill. Skipped names appear in the child system prompt and assignment transcript, separately from the worker's final report. Models, capability bundles, extensions, MCP requirements, tools, mandatory policies, and permissions retain their validation.

Explicit mentions supply descriptions and initial-turn defaults without exposing role bodies. Request-scoped hooks guard direct and nested tool dispatch. Background receipts require worker and assignment identities; foreground completion and question receipts also require their corresponding evidence. Parent coordination still determines dependencies and disjoint write ownership. A known worker report permits staged verification; the guard is not a dependency planner or sandbox.

Verified scoped results:

- Development mention workflow: 78 passed, 210 assertions. Log: `/tmp/pi-skill-final-dev.0OujY7/mentions.log`.
- Development runner: 271 passed, 1 skipped, 1,639 assertions. Final rerun and global typecheck exited 0 under `/tmp/pi-skill-confirmed.ynbPa9/`.
- Installed Pi 1.3.0 runner: 272 passed, 1,646 assertions. Installed mention regression: 14 passed, 45 assertions. Logs: `/tmp/pi-skill-final-installed.8hG9MT/`.
- Budget fixture workflow: 18 passed, 107 assertions. Log: `/tmp/pi-skill-budget-fixtures.tz89dv/test.log`.
- Mention-file Biome, five-file prose checking, both strict OpenSpec checks, and `git diff --check` passed.
- Runner lint passed with formatter and import assists disabled: 15 warnings and 1 info remain. Log: `/tmp/pi-skill-final-confirm.CBOj7D/runner-lint.log`. Full runner-file formatting/import acceptance is not established. Two stdin-based HEAD comparison attempts failed with “The contents aren't fixed”; they do not prove a warning baseline.

The missing-skill cases first failed at the resolver and actual child-startup boundaries. A further regression exposed substituted SDK metadata; filtering the loaded catalog fixed it. Installed mention checks initially exposed a changed SDK trigger signature and a sandbox-worker shutdown limit in the fixture. The fixture now uses the supported trigger signatures and two bounded scripts, without raising production limits. A nullable expected fixture path subsequently failed typecheck; an explicit fixture guard fixed it.

DeKit registration failed for the scoped test workflows; the discovered devenv tasks ran directly. Both delegated assignments initially exhausted their allowances without final reports; reporting-only continuations supplied saved handoffs. Both live worker sessions were then confirmed released.

No full-project test rerun, failure waiver, adaptive calibration, production ceiling review, or live UI acceptance is claimed. Tasks 6.2, 6.3, 6.4, 7.2, and 7.3 and the notice-delivery gate remain open.
