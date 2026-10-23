# Runner-maintenance pilot protocol

Status: smoke measured; calibration incomplete.

The five read-only microfixtures test the reporting/checking protocol. They are not yet representative budget-exhausting maintenance jobs. Do not force redundant tool calls to manufacture checkpoints.

## Limits and comparisons

- Maximum 26 trials, 15 minutes overall, and two minutes per trial, including failed trials. No paid warmups or automatic retries.
- Two blocks reverse fixed/advisory order. Each block adds a manually extended reference for the three non-blocker fixtures.
- All arms start with four turns and a fixture-only ceiling of eight. At the shared checkpoint after two completed turns, the reference receives one parent-controlled four-turn increment. Fixed/advisory arms receive no automatic grants.
- Stop after the first fixed/advisory/reference trio if none reaches admission. Stop on infrastructure, cleanup, persistence, mutation, deterministic-limit, or overall-deadline failure. Preserve failed attempts instead of silently replacing them.
- A retry must subtract prior attempts from the 26-trial limit and retain the original deadline. The recipe exposes both values.

## Evidence and interpretation

The checker accepts only bounded, exact cited facts in the declared wire format. It never returns raw model text. Reference labels depend on independently checked new facts, observed structural evidence, and verified blockers. Intended fixture labels are planning metadata, not measured labels. Report compliance is part of this microfixture metric; equivalent wording outside the declared encoding can fail.

The public report explicitly selects checked results and structural budget inputs. Full SDK entries, messages, tool details, model reports, and failure logs stay in private temporary directories. No transcript or fixture text reaches budget advice.

Record native SDK requests separately from transport fetch observations. Virtual routing calls are not physical SDK requests. Fetch-only instrumentation does not establish complete websocket/CLI provider-attempt totals. Classifier provider attempts come from shared-requester telemetry. Missing metrics remain unknown; SDK cost figures are estimates, not billing receipts.

Trial and suite elapsed time use a monotonic clock. Kernel decision duration uses its existing wall clock. Record the SDK/Bun/platform, source hashes, actual models, usage, failures, and stop reason. Use caches as found, without paid warming. Other agent activity is not controlled, so latency is descriptive.

A run with no eligible scored checkpoints cannot calibrate a threshold. Keep OpenSpec task 6.2 incomplete and production automatic grants disabled. Controlled adaptive trials require a separate threshold review.

## 2026-10-23 smoke

[Saved results](runner-maintenance-pilot-2026-10-23.json) retain all six attempts. The first trio exposed a reader bug. Saved history entries contain full SDK message snapshots, not visible assistant text. The pilot now reads only SDK text blocks. The report prompt also supplies its fixture ID and blocker encoding.

The corrected fixed, advisory, and reference outputs passed the independent fact checker. All three jobs finished in two turns, before admission. Both trios stopped with `no-checkpoint-in-first-case`. The retry retained the original deadline and used a remaining allowance of 23 trials.

Across both trios, the probe recorded 12 physical SDK requests and no classifier dispatches, grants, manual increments, or deterministic violations. SDK cleanup was confirmed for every trial. Complete worker provider-attempt counts remain unavailable. No threshold or savings claim follows from these results.

Direct hashline reads remained unknown under the reviewed outcome-envelope policy. Their saved tool-result details remain intact. Do not substitute `isError: false` or a correct report for a verified wrapper outcome.

The next useful workload must require enough real maintenance work to reach admission. Do not pad these microfixtures with redundant reads. Task 6.2 remains incomplete, and production automatic grants remain disabled.
