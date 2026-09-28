# Orchestration evals

Caliper evals for `../../instructions/orchestration.md`, loaded as an instruction
fragment rather than a discoverable skill. Run from the dotfiles root.

## Run

Requires the existing Pi/Caliper installation, installed `@gotgenes/pi-subagents`,
a working `openai-codex` model, and stored Jev gateway credentials for the steering
case. These commands use live model calls; there is no LLM judge for these specs.
The worker uses the selected candidate model with low thinking.

1. Run the controlled native-steering smoke test:
   ```sh
   scripts/caliper-skill-eval.sh --orchestration \
     --spec .pi/agent/evals/orchestration/steering.eval.yaml \
     orchestration gpt-5.5 low 1 gpt-5.5 low
   ```
2. Run the instruction-behavior cases:
   ```sh
   scripts/caliper-skill-eval.sh --orchestration \
     orchestration gpt-5.5 low 1 gpt-5.5 low
   ```
3. Run the same behavior cases without the instruction fragment:
   ```sh
   scripts/caliper-skill-eval.sh --orchestration --without-instructions \
     orchestration gpt-5.5 low 1 gpt-5.5 low
   ```

Use `--auth-profile NAME` for another existing auth profile. Increase the first
`1` to `3` for repeated runs after debugging. Keep the wrapper's single-worker
setting: the deterministic assertion reads the just-finished attempt's pointer.
Do not use skill `--ablate` for this instruction comparison.

## What is measured

- `orchestration.eval.yaml`: a one-file lookup stays with the parent; a supplied
  routine update does not trigger checkpoint assessment. The second case is a
  decision probe, not a real worker lifecycle test.
- `steering.eval.yaml`: a real background `quick` worker enters an event-driven
  gate. The parent observes a controlled scope-change report, calls the real Jev
  checkpoint tool, and sends native steering. The gate releases only after the
  native tool accepts the message. The worker must read only `assigned.txt` and
  return both its random contents and a marker disclosed only to the parent
  after the worker reached the gate. That marker must arrive through steering.
- `check.py`: checks recorded calls, matching worker IDs, ordering, actual read
  results, child output, and parent integration. Final claims alone cannot pass.
- `launch.py` and `fixture.ts`: isolate settings, load the instruction snapshot
  and extension allowlist, constrain reads, record evidence, and bound execution.

The smoke prompt explicitly requests a checkpoint call; it tests plumbing and
compliance, not spontaneous checkpoint recognition. The source instruction says
“may call,” so omission alone is not a failure in natural cases. `@quick` also
bypasses the routing recommendation hook in the smoke test. This is not a
complete routing, parallelism, blocker, or material-finding evaluation.

## Isolation and evidence

Each attempt has a disposable HOME and fixture directory. Only the native
subagent package, instruction loader, recommend-agent extension, and fixture
extension load. The fixture worker definition is deliberately read-only; this
is not an eval of the production `quick.md` prompt. Candidate tools cannot run
shell commands, write files, or read auth, specifications, traces, or the real
repository. This is a tool-level boundary, not an OS sandbox for extension code.

The existing wrapper's auth-copy and refresh-persistence behavior is unchanged.
Only synthetic task state is submitted to Jev. Jev unavailability or abstention
fails the live-assessment assertion; inspect the trace before interpreting a
failure as poor orchestration. Caliper 0.11 may also classify a provider refusal
as a task failure. A zero CLI exit code alone is not proof of a passing score.

The wrapper prints an evidence directory under `.caliper/orchestration/`, with
an exact instruction snapshot/hash, extension entrypoint hashes, package
version, treatment flag, per-attempt trace, and expected fixture contents.
Caliper saves scored results beneath this directory's `.caliper/results/`.
These generated directories are ignored by Git. Pin the saved result paths
when using `caliper compare`; the instruction treatment is in our evidence
metadata, not Caliper's skill-ablation field. Entrypoint hashes are not a full
transitive dependency snapshot; compare runs in the same checkout/environment.

## Validation and limits

Offline regression checks are included in `devenv tasks run test:caliper-skill-eval`.
Validate specs without model calls using `caliper validate <spec-path>`.

Initial `gpt-5.5:low`, k=1 results: controlled steering passed; both behavior
cases passed with and without the fragment. This verifies the fixture but shows
no instruction benefit on those two easy cases. It is not a reliability estimate.
Add harder cases with observable outcomes before making quality claims; keep
explicit-protocol tests separate from natural instruction-adherence tests.
