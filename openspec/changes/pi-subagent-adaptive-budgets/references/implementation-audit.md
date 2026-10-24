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

## Formatting/import verification follow-up

The follow-up started from clean HEAD `49767991`. Four runner files now follow the configured formatting and import order. Wrapping the installed-SDK fixture call exposed an unused `@ts-expect-error` and the expected fifth-argument error. Moving the existing directive to that argument restored typecheck without changing the call.

Verified results:

- The full Biome check on the seven selected runner files exits 0, with 15 warnings and 1 info. The earlier check reported six errors and the same warning/info counts. Its diagnostic limit omitted two warning details.
- Development runner tests pass: 271 passed, 1 skipped, 1,639 assertions. Installed Pi 1.3.0 runner tests pass: 272 passed, 1,646 assertions. Final logs are in `/tmp/pi-format-runner-confirm.HjYJ2B/`.
- Mention tests pass: 78 passed and 210 assertions. Log: `/tmp/pi-format-dev.cv5ahQ/mentions.log`.
- Main typecheck and the selected-file Biome check exit 0. Logs: `/tmp/pi-format-final.vuPtVP/`.
- The benchmark project typecheck exits 0 under `benchmarks/tsconfig.subagent-budgets.json`; budget fixtures pass 18 tests and 107 assertions. The reported neighbor errors about missing `Bun` globals do not reproduce with that configuration. Logs: `/tmp/pi-format-budget.jc0koY/`.
- Whitespace-minified emitted JavaScript matches the captured pre-format inputs for all four files. Those inputs were captured after import-declaration ordering changes. Unminified byte comparisons differed because the printer retained layout. Inputs and outputs are in `/tmp/pi-runner-format.9w4Ldk/`.

Before the approved runner-wide cleanup, the broader Biome check failed across 65 runner files: 40 errors, 106 warnings, and 9 infos. There were 26 additional files with 26 formatting errors and 13 import-order errors. The remaining error was `lint/suspicious/noControlCharactersInRegex` in `extensions/subagents/__tests__/rendering.test.ts`. Log: `/tmp/pi-runner-full-biome.log`. The user approved the broader cleanup; its results follow.

DeKit registration failed again for the runner workflow; discovered devenv tasks ran directly. The formatter script also hit codemode's state-storage limit before applying formatted files. Recovery used the generated temporary files without storing full sources in session state.

No full-project test rerun, live reload/UI acceptance, failure waiver, threshold review, or production-ceiling review is claimed. OpenSpec tasks 6.2, 6.3, 6.4, 7.2, and 7.3 remain open.

## Runner-wide cleanup acceptance

The approved cleanup formatted the 26 additional files and organized imports in 13 files. The ANSI background-reset assertion in `rendering.test.ts` retains its regex and negative assertion. A narrow Biome suppression explains why that test must match control characters.

Final checks:

- Full runner Biome check passes across all 65 files, with no errors, 106 warnings, and 9 infos. Comparing file/rule diagnostic counts confirms that the warning/info set is unchanged from the pre-cleanup check. No warning-level lint rewrites were applied.
- Main and benchmark-project typechecks exit 0. Logs for all three static checks are in `/tmp/pi-runner-wide-static.XoHgbt/`.
- Development runner tests pass: 271 passed, 1 skipped, 1,639 assertions. Mention tests pass: 78 passed and 210 assertions. Budget fixtures pass: 18 passed and 107 assertions. Logs are in `/tmp/pi-runner-wide-dev.rt489I/`.
- Installed Pi 1.3.0 runner tests pass: 272 passed and 1,646 assertions. Log: `/tmp/pi-runner-wide-installed.YHiTn6/runner.log`.
- Before applying the 26 formatting changes, whitespace-minified JavaScript matched every captured input. The 13 subsequent import-only changes were reviewed separately. Inputs, outputs, and manifests are in `/tmp/pi-runner-wide-format.3pcQ2J/`.

An import-preparation reader initially rejected the empty temporary log `import-0.log`. Handling the hashline empty-file sentinel resolved that tooling failure before any import edits.

Runner-wide formatting/import acceptance is now established. Full-project test acceptance and live reload/UI acceptance remain open, as do OpenSpec tasks 6.2, 6.3, 6.4, 7.2, and 7.3. Automatic grants remain disabled; this cleanup changes no production budget policy, specialist ceiling, dependency, or lockfile.

## Live smoke checks after reload

After the user reported reloading Pi, native runner calls verified these cases:

- Foreground startup on `quick` read the README and returned `RELOAD_STARTUP_OK` with heading `# Subagents`. Worker `9c1fec2e-178d-439b-bbd4-b69a4cabb865`, assignment `95839382-47eb-49b9-b95f-e2e881e24644`.
- Continuation on that same worker reached a saved `waiting-question` state. Question `7249e9c2-5685-43c7-83dc-018ec1ec8bb1` received the correlated reply `RELOAD_ACK_20261024`. Assignment `93f948ed-759b-43ca-89d8-5fac8bc18f13` returned `QUESTION_REPLY_OK` with that exact reply.
- With user approval, the temporary read-only specialist `reload-skill-smoke` selected the intentionally missing skill `pi-reload-smoke-nonexistent-skill`. Normal preflight and a real read succeeded. Worker `e719b57e-847a-4ad8-bc34-19c510a897a0`, assignment `21d678c3-ada3-4bae-871f-ce318731e31a`, returned `MISSING_SKILL_STARTUP_OK`. Native transcript evidence independently contains `Skipped unavailable skills: pi-reload-smoke-nonexistent-skill` in both a system notice and the system-prompt addendum.
- A further continuation, assignment `f5a902d3-580b-46ce-a14d-2fee687a78ea`, reached question `45be7bff-ac87-47d7-b315-eb4dd3a34e6e` with text `CANCEL_GATE_20261024`. Cancellation first returned `stopping`, then native status confirmed `cancelled` with `liveSession: released`. All three quick assignments showed `saved`.
- Both smoke workers are released. Reports from the completed question and missing-skill assignments remain retrievable after release. The missing-skill assignment also showed `saved`.

Bounded evidence is in `/tmp/pi-reload-smoke.1WFd77/missing-skill-evidence.json` and `/tmp/pi-reload-smoke.1WFd77/lifecycle-evidence.json`. These checks establish observed runner transitions and history acknowledgement, not crash durability.

Fixture cleanup is blocked. The agent's approved removal command failed with `Semantic command guard could not assess this command.` No alternative deletion route or guard-policy change was attempted. The user selected manual removal, but the subsequent absence check exited 1: `.pi/agent/agents/reload-skill-smoke.md` was still present at that check. Its worker is released; the file remains an extra read-only role until removed.

Tooling inspection also encountered an unavailable `get_goal`, a transcript-page parsing assumption, and a codemode variable-name error. The latter two were corrected before accepting transcript evidence. None is counted as application validation evidence.

Visual layout/focus, UI cancellation confirmation, animation, queue-capacity behavior, unsolicited notification delivery, and in-flight reload/shutdown remain unverified. Full-project acceptance and OpenSpec tasks 6.2, 6.3, 6.4, 7.2, and 7.3 remain open. Automatic grants remain disabled.

## Queued notification freshness, 2026-10-24

The parent received the `CANCEL_GATE_20261024` question after native status had already confirmed cancellation and release. The later completion receipt correctly showed cancelled/released/saved. The stale question was historical evidence, not a new request for an answer.

Two delivery defects reproduced at the SDK context-hook boundary: questions and receipts had no refresh token, and settled update tokens were discarded after one projection. `WorkerDelivery` now tracks all structural notices until runtime shutdown. Questions expose `requiresReply` for the exact current question. Receipts refresh worker metadata while retaining their original assignment. Repeated projections preserve settled updates. Saved messages, question/update text, public tools, persisted identifiers, and permission policies remain unchanged. This corrects model context, not displayed historical messages.

Evidence:

- The staged working tree at HEAD `49767991`, before this correction, produced 270 passes, 1 skip, and 1 failure: production definitions expected 20 roles but found 21. The staged smoke fixture accounts for the extra role. Log: `/tmp/pi-notice-freshness-baseline-run.ETt1kt/test.log`. This was not a clean-HEAD comparison.
- `devenv tasks run test:pi-subagents` reproduced four freshness failures before the source fix: repeated projection, answered question, cancelled question, and receipt after release. The role-count failure remained separate. Log: `/tmp/pi-notice-freshness-red.Gi6KRS/test.log`.
- After the fix, development SDK tests reported 275 passes, 1 skip, 1 failure, and 1,676 assertions across 277 tests. Installed Pi 1.3.0 reported 276 passes, 1 failure, and 1,683 assertions. Both failures were the unchanged role-count assertion. Logs: `/tmp/pi-notice-freshness-green.NbU4Fk/test.log` and `/tmp/pi-notice-freshness-installed.oH3Mg5/test.log`. Coverage also verifies exact question correlation, original receipt assignment after continuation, saved evidence, and no extra child starts during projection.
- Fresh Serena error-level diagnostics returned no errors for all four edited TypeScript files. This does not replace project typecheck. The typecheck command was blocked twice, before execution, with `Semantic command guard could not assess this command.`; no alternate execution route or policy relaxation was used.

Tooling limits: DeKit registration for `devenv:test:pi-subagents` failed without diagnostics; an intent lookup returned `fallbackReason: http-status`. The discovered task ran directly. The installed devenv rejects `--filter`, so that attempt exited 2 before running tests. The baseline also logged an already-present Cachix substituter warning. An exhausted codemode scratch store prevented caching OpenSpec instructions; the instructions were retrieved without storage. An anchor-form `read` request returned `E_BAD_SHAPE`; prior served source and edit diffs remained available.

The new JSON report's writer-provided auto-read anchor failed `E_BAD_SHAPE` ownership validation against `host.ts`. A fresh hashline `read` of the report returned usable anchors. An initial inventory assertion also stopped before writing because it assumed 31 distinct named Pi failures; the final inventory records the 30 enumerated names alongside the reported totals.

Before manual fixture cleanup, the development rerun reported: 275 passes, 1 skip, 1 role-count failure, and 1,676 assertions; `/tmp/pi-notice-freshness-final-runner.a2NVLv/test.log`. Changed-file Biome passed with 3 warnings and 2 infos. Prose checked all four documentation files without warnings; strict validation of both OpenSpec changes and `git diff --check` passed. Logs are under `/tmp/pi-notice-freshness-final-checks.gIyyiN/`. No dependency, lockfile, staging, or guard-policy changes were made by this follow-up.

After manual fixture cleanup, both SDK suites passed. Development: 276 passes, 1 skip, 0 failures, and 1,673 assertions. Installed Pi 1.3.0: 277 passes, 0 failures, and 1,680 assertions. Logs: `/tmp/pi-notice-freshness-clean-dev.mnk7da/test.log` and `/tmp/pi-notice-freshness-clean-installed.gwcIr8/test.log`.

Full `devenv test` subsequently exited 1. `test:pi-extensions` reported 2,512 passes, 31 failures, 8 skips, 1 error, and 15,604 assertions across 2,551 tests and 262 files. Seven other tasks failed, and `test:all` failed on dependencies. The [validation inventory](notification-freshness-validation-2026-10-24.json) retains every named failure and failed task with unresolved, non-waived dispositions. The Pi extension summary enumerates 30 named failures while reporting 31 failures and one unhandled error; these counts are preserved rather than silently reconciled. The unhandled Gantt error reports unavailable `fc-match`; the AGS task reports unavailable `ags`. No matching clean-HEAD baseline establishes causality, and this run does not waive the earlier acceptance blocker.

The full Pi task uses `set -e`: its failing Bun suite prevented the following project typecheck from running. The standalone typecheck remains guard-blocked. No unrelated implementation fixes, guard relaxation, tracked dependency changes, or acceptance exceptions were applied. Full log: `/tmp/pi-notice-freshness-full.kVxPyL/devenv-test.log`.

The user removed the smoke fixture from staging and disk. Subsequent metadata checks confirmed no index entry and no file or symlink; the agent did not modify staging. Compiler verification was completed through the user-approved guard follow-up below, without relaxing classifier failure handling.

## Repo-local rm symlink traversal, 2026-10-24

The user approved this separate repair after full validation exposed the guard failure. The trust boundary is the automatic repo-local removal exemption: in confirm mode, untrusted literal operands resolving outside the repository could bypass normal semantic review. This was a high-severity review bypass, not evidence of an observed outside-repository deletion.

The focused existing test reproduced 12 passes and 1 failure in 34 ms. Expanded security coverage reproduced 14 passes and 6 failures before the implementation change. A filesystem probe showed that Bun's regular and native `realpath` normalize raw `..` paths prematurely; Node's native resolver preserved the physical traversal. The helper now resolves components before applying parent traversal and rejects the final repository root. Missing local targets and valid in-repository symlinks retain their exemptions. Parser rules, guard modes, catastrophic checks, and classifier fail-closed behavior were not relaxed.

Implementation changes are confined to `repo-local-rm.ts` and its neighboring tests. `index.test.ts` received only the formatter's array-layout change; metadata checks confirmed that file had no staged or worktree changes beforehand. No dependency, lockfile, staging, or unrelated implementation changes were made.

Verification:

- `bun test ./.pi/agent/extensions/semantic-command-guard/__tests__/repo-local-rm.test.ts`: 22 passes, 0 failures, 23 assertions. Log: `/tmp/pi-rm-symlink-final-unit.HjX6Xv/test.log`.
- `devenv tasks run test:pi-command-guard`: exit 0; 193 passes, 0 failures, 337 assertions across 6 files, followed by the declared Biome check and successful `tsc --noEmit`. Log: `/tmp/pi-rm-symlink-verified.6wZOCa/test.log`.
- Ten additional path checks passed under Node 24.20.0 and Bun 1.4.2. The debug/parity scripts remain in the clearly named `/tmp/pi-rm-resolution.0DkYDs/` directory; their temporary filesystem fixtures were cleaned. No actual escaping removal command was executed.
- Fresh error-level diagnostics for the helper and path tests returned no errors. `git diff --check` passed.

Tooling limits: the first direct Bun invocation omitted the `./` prefix and matched no hidden-directory test files; the corrected invocation reproduced the actual regression. The first declared guard workflow ran all 193 tests successfully but stopped on three formatter diagnostics. These were corrected through hashline edits. The neighboring test edit initially required an actual `read` despite prior served grep anchors; the requested read was performed before retrying.

The full-validation inventory above is a pre-guard-fix snapshot, not a rerun or waiver. Static path checks remain subject to filesystem races, and Linux runtime validation was not performed. A Pi `/reload` is required to activate the changed extensions and verify live behavior.

Task 7.1 is complete again: 16 of 21 tasks are complete. Tasks 6.2, 6.3, 6.4, 7.2, and 7.3 remain unchecked. Visual UI acceptance, broader live lifecycle acceptance, full-project failure disposition, and representative budget calibration remain open. Automatic grants remain disabled.

## Reloaded question and completion freshness, 2026-10-24

After the user reported a Pi reload, a read-only `quick` worker read `.pi/agent/extensions/subagents/README.md`, asked `NOTICE_FRESHNESS_RELOAD_20261024`, and received the correlated reply `NOTICE_FRESHNESS_ACK_20261024`. Native transcript inspection confirmed that the read was its first tool operation, succeeded with the heading `# Subagents`, and introduced no file writes.

Worker `c199c446-34f8-4b0f-8a65-3643c39179c3` completed assignment `5b52804d-7652-43af-809e-79b00dce81cb` in four of four turns. The parent verified the final marker `NOTICE_FRESHNESS_RELOAD_OK` and exact reply text, released the session, and retrieved the saved report after release.

The delayed question retained ID `e5781fba-f0de-4a2f-a897-bcc34893fc50` and its original text while the model-context projection reported `requiresReply: false` and current released-worker metadata. The later completion receipt also showed the released session, original completed assignment, saved persistence, and `reportAvailable: true`. Its `verified: false` field remained intact; the receipt did not claim to verify the report.

The [live reload evidence](notification-freshness-live-reload-2026-10-24.json) records the checked values. This bounded pass does not establish visual UI behavior, native settled-update repetition, cross-continuation attribution, queue capacity, in-flight reload/shutdown, or the classifier setup matrix. Task 7.3 remains unchecked.

Tooling limits: `tools.get_goal` was unavailable. Native report output was plain text, and transcript output used tab-delimited TOON; initial JSON decoding assumptions were corrected. The codemode scratch store was full, so the evidence was written directly without deleting unrelated stored state.

## UI acceptance and validation access, 2026-10-24

The user accepted the UI with "ui is fine; move on". This is user-reported acceptance, not automated visual inspection. No further UI probe was launched.

The validation preflight on clean HEAD `3a1f9f6029ce8dce784ac8e95675cb590a710809` failed before acceptance evidence could be obtained. DeKit registration failed without diagnostics, and status returned an invalid-runner-response error. Direct `devenv tasks list` exited 1; inspecting its existing data directory returned `EPERM`.

The user approved a scoped launcher grant for the existing default/XDG devenv state directory. The fix and neighboring regression tests leave its parent directories ungranted, omit missing state, and retain rejection of non-directory state. The focused suite passed 29 tests and 109 assertions after the two expected missing-grant failures and one corrected test assumption. Scoped Biome and `git diff --check` passed. The [access evidence](devenv-sandbox-access-2026-10-24.json) preserves the commands, results, failures, and logs.

Direct `tsc --noEmit` reported SDK/type diagnostics without the required SDK synchronization. The declared `bun run typecheck` then stopped in `sdk:sync` because the sandbox denied the Nix daemon socket. Neither invocation establishes project typecheck acceptance.

The active profile grants that socket only on Linux. Its Linux prerequisites require root-only daemon trust and sandboxed builds. The Mac instead trusts `fbb` and `@admin` and has `sandbox = false`. After inspecting these facts, the user chose to keep macOS socket access blocked and run validation outside Pi. No Nix repository or deployed profile was changed. The launcher grant requires a new Pi process, not a Nix rebuild or `/reload`.

A separate read-only update probe completed in three of four turns, sent `LIVE_UPDATE_FRESHNESS_20261024` through `worker_update`, and returned `LIVE_UPDATE_DONE_20261024`. Native tool evidence confirmed "Update sent.". Worker `119efc18-9da1-44ce-a4d3-f1007f0af5a0`, assignment `6cd11452-f8a7-4265-b402-947dcef78d78`, was saved and released. Queued model-context delivery remains unverified at this checkpoint.

Full-project acceptance now awaits an external workflow result. Tasks 6.2, 6.3, 6.4, 7.2, and 7.3 remain unchecked; automatic grants remain disabled.
