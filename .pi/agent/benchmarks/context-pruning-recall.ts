import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime, type SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import { placeholder, selectMasks } from "../extensions/context-masking/policy";
import { latencyStats, QUESTIONS } from "./context-compaction-classify";
import {
  assistant,
  type ProbeCase,
  type ProbeOutcome,
  run,
  scoreRun,
} from "./context-masking-recall-probe";

// Synthetic-only: no recorded sessions are sent to either provider.
// Selection sees the original task, never the later recall question or expected answer.
export const TASK =
  "Investigate the nightly migration failure. Establish its root cause and preserve the approved recovery configuration. Routine successful checks are background noise.";
export const ARMS = ["inline", "deterministic", "recency", "classifier"] as const;
export type Arm = (typeof ARMS)[number];
export interface Observation {
  path: string;
  text: string;
}
export interface History {
  observations: Observation[];
  diagnosis: string;
  decision: string;
  surprise: string;
}

export function history(token = () => randomBytes(8).toString("hex")): History {
  const diagnosis = `cause-${token()}`;
  const decision = `recovery-${token()}`;
  const surprise = `audit-${token()}`;
  const details = [
    ["reports/connectivity.txt", "Connectivity check passed. No action needed."],
    [
      "reports/root-cause.txt",
      `Confirmed root cause: invalid migration ordering. Incident signature: ${diagnosis}. Recovery depends on this finding.`,
    ],
    ["reports/storage.txt", "Storage check passed. No action needed."],
    [
      "reports/approved-recovery.txt",
      `Approved decision: use recovery profile ${decision}; preserve this exact profile for the next migration attempt.`,
    ],
    [
      "reports/old-audit.txt",
      `Unrelated completed audit; not part of the migration. Archived audit receipt: ${surprise}. No pending action.`,
    ],
    ["reports/memory.txt", "Memory check passed. No action needed."],
    ["reports/cpu.txt", "CPU check passed. No action needed."],
    ["reports/health.txt", "Health check passed. No action needed."],
  ];
  const observations = details.map(([path = "", detail = ""], i) => {
    const prefix = `Historical report ${i}.\n`;
    const padding = Array.from({ length: 120 }, (_, n) => `sample ${n}: ok; metric ${n % 17}`).join(
      "\n",
    );
    const body = `${prefix}${padding}\n${detail}\n`;
    return { path, text: body.padEnd(4_000, ".") };
  });
  return { observations, diagnosis, decision, surprise };
}

export function questions(h: History): ProbeCase[] {
  const make = (
    name: string,
    index: number,
    question: string,
    answer: string,
    needsRecall = true,
  ): ProbeCase => ({
    name,
    tool: "read",
    args: { path: h.observations[index]?.path ?? "" },
    files: {},
    maskedText: h.observations[index]?.text ?? "",
    question,
    answer,
    needsRecall,
  });
  return [
    make(
      "diagnosis",
      1,
      "What exact incident signature did the confirmed root-cause report give? Reply with only that signature.",
      h.diagnosis,
    ),
    make(
      "decision",
      3,
      "What exact recovery profile was approved earlier? Reply with only the profile.",
      h.decision,
    ),
    make(
      "surprise",
      4,
      "Change of topic: what was the exact audit receipt in the old completed audit report? Reply with only the receipt.",
      h.surprise,
    ),
    make("control", 0, "What is 17 * 23? Reply with only the number.", "391", false),
  ];
}

export function chooseKept(arm: Arm, scores: readonly number[], count: number): Set<number> {
  if (arm === "inline") return new Set(Array.from({ length: count }, (_, i) => i));
  if (arm === "deterministic") return new Set();
  // Equal-size results make this the same retained-text budget for both ranked arms.
  const order = Array.from({ length: count }, (_, i) => i);
  if (arm === "classifier") order.sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || b - a);
  else order.reverse();
  return new Set(order.slice(0, 2));
}

export async function buildHistory(h: History, arm: Arm, scores: readonly number[], dir: string) {
  const cwd = join(dir, "work");
  await mkdir(cwd, { recursive: true });
  const manager = SessionManager.inMemory(cwd);
  manager.appendMessage({ role: "user", content: TASK, timestamp: 0 });
  const ids: string[] = [];
  for (const [i, observation] of h.observations.entries()) {
    const callId = `observation${i}`;
    manager.appendMessage(
      assistant([
        { type: "toolCall", id: callId, name: "read", arguments: { path: observation.path } },
      ]),
    );
    ids.push(
      manager.appendMessage({
        role: "toolResult",
        toolCallId: callId,
        toolName: "read",
        content: [{ type: "text", text: observation.text }],
        isError: false,
        timestamp: 0,
      }),
    );
  }
  // Keep the same ten-turn protected tail in every arm.
  for (let i = 0; i < 10; i++) {
    const callId = `tail${i}`;
    manager.appendMessage(
      assistant([
        {
          type: "toolCall",
          id: callId,
          name: "read",
          arguments: { path: `checks/check-${i}.txt` },
        },
      ]),
    );
    manager.appendMessage({
      role: "toolResult",
      toolCallId: callId,
      toolName: "read",
      content: [{ type: "text", text: "Routine check passed." }],
      isError: false,
      timestamp: 0,
    });
  }
  manager.appendMessage(
    assistant([{ type: "text", text: "Investigation complete. Ready for the next request." }]),
  );
  const candidates = selectMasks(manager.buildSessionProjection().entries, {
    protectRecentTurns: 10,
    minResultChars: 800,
  });
  const eligible = new Set(candidates.map((c) => c.entryId));
  if (eligible.size !== h.observations.length)
    throw new Error("Unexpected deterministic candidate set");
  const kept = chooseKept(arm, scores, h.observations.length);
  const artifacts: string[] = [];
  const savedDir = join(dir, "saved", manager.getSessionId().replace(/[^A-Za-z0-9_-]/gu, "_"));
  await mkdir(savedDir, { recursive: true, mode: 0o700 });
  for (const [i, observation] of h.observations.entries()) {
    const id = ids[i];
    if (id === undefined) throw new Error("Missing observation entry");
    const artifact = join(savedDir, `${id}.txt`);
    await writeFile(artifact, observation.text, { mode: 0o600 });
    artifacts.push(artifact);
    if (!kept.has(i))
      manager.appendContextEdit(id, {
        content: [
          {
            type: "text",
            text: placeholder({ entryId: id, toolName: "read", text: observation.text }, artifact),
          },
        ],
      });
  }
  manager.appendCustomEntry("context-masking", {
    items: ids.flatMap((entryId, i) =>
      kept.has(i) ? [] : [{ entryId, toolName: "read", path: artifacts[i] }],
    ),
  });
  const visible = manager.buildSessionProjection().messages;
  const contextChars = JSON.stringify(visible).length;
  const sessionFile = join(dir, "session.jsonl");
  await writeFile(
    sessionFile,
    `${[manager.getHeader(), ...manager.getEntries()].map((e) => JSON.stringify(e)).join("\n")}\n`,
    { mode: 0o600 },
  );
  return { sessionFile, cwd, artifacts, kept: [...kept], contextChars };
}

async function classify(h: History, runtime: ModelRuntime) {
  const model = runtime
    .getModelsOfType("classifier", "openrouter")
    .find((m) => m.id === "typesafe/jev-1.14");
  if (!model) throw new Error("OpenRouter Jev classifier is unavailable");
  const scores: number[] = [];
  let cost = 0;
  const started = performance.now();
  // All eight requests are independent and match the previous benchmark's concurrency.
  await Promise.all(
    h.observations.map(async (observation, i) => {
      const result = await runtime.classify(model, {
        state: {
          CURRENT_REQUEST: TASK,
          BLOCK: observation.text,
          TOOL_ARGUMENTS: { path: observation.path },
        },
        questions: QUESTIONS,
      });
      if (result.stopReason !== "stop")
        throw new Error(`Classifier failed: ${result.errorMessage}`);
      const a = result.answers;
      const relevance = a.relevance;
      const bools = [a.constraint, a.decision, a.unresolved];
      if (relevance?.type !== "score" || bools.some((b) => b?.type !== "bool"))
        throw new Error("Incomplete classifier response");
      scores[i] =
        (0.5 * relevance.score) / 3 +
        0.5 * Math.max(...bools.map((b) => (b?.type === "bool" ? b.probability : 0)));
      cost += result.usage?.cost.total ?? 0;
    }),
  );
  return { scores, cost, ms: performance.now() - started };
}

async function main() {
  const [model = "vercel-ai-gateway/openai/gpt-4.1-mini", repeatsArg = "2"] = process.argv.slice(2);
  const repeats = Number(repeatsArg);
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10)
    throw new Error("Repeats must be 1–10");
  const gapMs = Number(process.env.PROBE_GAP_MS ?? "0");
  if (!Number.isFinite(gapMs) || gapMs < 0) throw new Error("PROBE_GAP_MS must be nonnegative");
  let lastFinished = 0;
  const root = await mkdtemp(join(tmpdir(), "context-pruning-recall-"));
  const runtime = await ModelRuntime.create();
  const results: (ProbeOutcome & {
    repeat: number;
    case: string;
    arm: Arm;
    exit: number;
    error: string;
    kept: number[];
    contextChars: number;
    prepMs: number;
    elapsedMs: number;
    totalMs: number;
    initialPromptTokens: number;
    cumulativeInputTokens: number;
  })[] = [];
  const selections = [];
  for (let repeat = 0; repeat < repeats; repeat++) {
    const h = history();
    const selection = await classify(h, runtime);
    selections.push(selection);
    // Serial arms avoid provider queueing differences; rotate order across repetitions.
    const arms = [...ARMS.slice(repeat % ARMS.length), ...ARMS.slice(0, repeat % ARMS.length)];
    for (const probe of questions(h)) {
      for (const arm of arms) {
        const dir = join(root, `${repeat}-${probe.name}-${arm}`);
        // Pacing avoids gateway quotas; exclude this intentional wait from measured latency.
        const waitMs = gapMs - (performance.now() - lastFinished);
        if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
        const startedBuild = performance.now();
        const built = await buildHistory(h, arm, selection.scores, dir);
        const prepMs = performance.now() - startedBuild + (arm === "classifier" ? selection.ms : 0);
        const before = (await readFile(built.sessionFile, "utf8")).trim().split("\n").length;
        const started = performance.now();
        const outcome = await run(
          process.env.PI_BIN ?? "pi",
          [
            "-p",
            "-ne",
            "-ns",
            "-np",
            "-nc",
            "--no-mcp",
            "--tools",
            "read",
            "--thinking",
            "minimal",
            "--system-prompt",
            "Answer the user's question accurately. Historical tool results may be replaced by pointers to exact saved results; use read when needed. Do not guess missing values.",
            "--session",
            built.sessionFile,
            "--model",
            model,
            probe.question,
          ],
          built.cwd,
          120_000,
        );
        const elapsedMs = performance.now() - started;
        lastFinished = performance.now();
        const entries: SessionEntry[] = (await readFile(built.sessionFile, "utf8"))
          .trim()
          .split("\n")
          .slice(before)
          .map((line) => JSON.parse(line));
        const target = probe.name === "diagnosis" ? 1 : probe.name === "decision" ? 3 : 4;
        const scored = scoreRun(entries, probe, built.artifacts[target] ?? "");
        const usage = entries.flatMap((e) =>
          e.type === "message" && e.message.role === "assistant" ? [e.message.usage] : [],
        );
        const row = {
          repeat,
          case: probe.name,
          arm,
          exit: outcome.code,
          error: outcome.code === 0 ? "" : outcome.stderr,
          ...scored,
          kept: built.kept,
          contextChars: built.contextChars,
          prepMs,
          elapsedMs,
          totalMs: prepMs + elapsedMs,
          initialPromptTokens: usage[0]
            ? usage[0].input + usage[0].cacheRead + usage[0].cacheWrite
            : 0,
          cumulativeInputTokens: usage.reduce(
            (n, u) => n + (u?.input ?? 0) + (u?.cacheRead ?? 0) + (u?.cacheWrite ?? 0),
            0,
          ),
        };
        results.push(row);
        console.error(`${repeat} ${probe.name} ${arm}: ${JSON.stringify(row)}`);
        await writeFile(
          join(root, "results.json"),
          JSON.stringify({ model, selections, results }, null, 2),
        );
        if (outcome.code !== 0)
          throw new Error(`Probe failed; evidence at ${root}: ${outcome.stderr}`);
      }
    }
  }
  const arms = Object.fromEntries(
    ARMS.map((arm) => {
      const rows = results.filter((r) => r.arm === arm);
      return [
        arm,
        {
          runs: rows.length,
          correct: rows.filter((r) => r.correct).length,
          artifactRecalls: rows.filter((r) => r.recalledArtifact).length,
          toolCalls: rows.reduce((n, r) => n + r.toolCalls, 0),
          contextChars: latencyStats(rows.map((r) => r.contextChars)),
          initialPromptTokens: latencyStats(rows.map((r) => r.initialPromptTokens)),
          elapsedMs: latencyStats(rows.map((r) => r.elapsedMs)),
          totalMs: latencyStats(rows.map((r) => r.totalMs)),
        },
      ];
    }),
  );
  const report = {
    root,
    model,
    classifier: "openrouter/typesafe/jev-1.14",
    classifierCost: selections.reduce((n, s) => n + s.cost, 0),
    selections,
    arms,
  };
  await writeFile(join(root, "summary.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
