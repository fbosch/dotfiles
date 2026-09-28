# Orchestration evals

Caliper evals for `../../instructions/orchestration.md`, loaded as an instruction
fragment rather than a discoverable skill. Run from the dotfiles root.

## Run

Requires the existing Pi/Caliper installation, Python with PyYAML, installed
`@gotgenes/pi-subagents`, production model catalogs, and working model and Jev
credentials. These commands make live calls. All grading is deterministic;
there is no LLM judge.

1. Run the behavior suite once:
   ```sh
   scripts/caliper-skill-eval.sh --orchestration orchestration
   ```
2. Run the separate native-steering protocol:
   ```sh
   scripts/caliper-skill-eval.sh --orchestration \
     --spec .pi/agent/evals/orchestration/steering.eval.yaml orchestration
   ```
3. Compare behavior without the instruction fragment:
   ```sh
   scripts/caliper-skill-eval.sh --orchestration --without-instructions orchestration
   ```
4. Repeat after validating the fixture:
   ```sh
   scripts/caliper-skill-eval.sh --orchestration orchestration configured configured 3
   ```

Use `--auth-profile NAME` for another existing auth profile. Keep Caliper's
single-worker setting: assertions read the just-finished attempt's pointer.
Native subagents within an attempt can run concurrently. Use
`--without-instructions`, not skill `--ablate`, for the baseline.

## Models

The parent defaults to `modes.build.model` and `modes.build.thinkingLevel` from
`.pi/agent/settings.json`. Worker model, thinking, and role descriptions come
from `.pi/agent/agents/{quick,explore,analyze,debug,review,validate,test}.md`;
same-named `.pi/agents/` definitions take precedence. Disabled agents stay
unavailable. A missing or invalid preset is an error, not a fallback.

Each run snapshots that catalog and the required entries from `models.json`
and `models-store.json`. The isolated runtime loads `openai-capabilities.ts`,
which translates configured `*-fast` aliases to the base model with priority
service. Traces record actual parent and worker model/thinking selections and
outgoing model IDs/service tiers. Assertions compare these with the snapshot.
Specialist model overrides fail, even if a later retry succeeds.

Optional model arguments must name a configured model. The old `gpt-5.5:low`
invocation is intentionally rejected unless that model becomes configured.
Worker prompts are bounded fixture instructions, not copies of production
agent skill workflows. This evaluates orchestration using production execution
presets, not the quality of every production agent prompt.

## Coverage

`orchestration.eval.yaml` contains eleven behavior cases:

- Direct work: a one-file lookup stays with the parent.
- Routine progress: a supplied ordinary update does not require intervention.
- Specialist selection: discovery, diagnosis, and review route to their roles.
- Delegation quality: the assignment carries target, scope, read-only and
  command restrictions, required output, export verification, and a turn budget.
- Parallelism: two distinct workers reach an event-driven barrier before
  either leaves it. Each reads only its assigned file and reports its marker.
- Dependencies: the second worker starts after the prerequisite report and
  receives its random token in the assignment.
- Resume: the parent continues the original worker ID and session after its
  first report, rather than spawning a replacement.
- Material finding: an unsupported API capability causes a revised decision.
- Blocker: missing administrator input is escalated instead of invented.

`steering.eval.yaml` is an explicit protocol test. A real background worker waits
at a gate while the parent calls Jev and sends native steering. Only successful
steering releases it. The worker must acknowledge a random marker disclosed
only to the parent after the gate was reached, then read the assigned file.
The `@quick` request deliberately bypasses delegation routing in this case.

The natural finding/blocker prompts do not mention checkpoints or steering.
They grade evidence-backed decisions after worker reports. The instruction says
"may call", so Jev assessment is optional there; its use and checkpoint kind are
recorded. These cases do not measure spontaneous mid-execution interruption.
Routine progress is a decision probe, not a live-worker scenario.

## Isolation and evidence

Each attempt has a disposable HOME and synthetic workspace. The extension
allowlist contains native subagents, the model translation hook, instruction
fragments, recommend-agent, and the fixture. Model tools cannot execute shell
commands, write files, or read credentials, specs, traces, or the real repository.
The copied swarm skill is the only read exception outside the workspace.
This is a tool-level boundary, not an OS sandbox for extension code.

The wrapper's existing auth-copy and refresh-persistence behavior is unchanged.
Only synthetic task state is sent to Jev. Provider refusals, Jev unavailability,
and fixture timeouts must be distinguished from behavior failures using traces.
Caliper can exit zero despite failed cases.

The wrapper prints `.caliper/orchestration/run.*`, containing instruction and
model snapshots, hashes, metadata, traces, expected fixture values, and
per-attempt assessment summaries. Caliper scores are under this directory's
`.caliper/results/`. Generated artifacts are ignored by Git. Compare explicit
result paths with `caliper compare`; instruction treatment is recorded in our
metadata rather than Caliper's skill-ablation field. Extension entrypoint hashes
are not a complete transitive dependency snapshot.

Offline checks: `devenv tasks run test:caliper-skill-eval`.
Spec validation without model calls: `caliper validate <spec-path>`.
Single runs establish execution evidence, not reliability or instruction benefit.
