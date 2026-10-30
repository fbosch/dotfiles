import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Usage } from "@earendil-works/pi-ai";
import {
  type BeforeAgentStartEvent,
  type BeforeAgentStartEventResult,
  type ExtensionAPI,
  type ExtensionContext,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { approveEveryCandidate } from "../extensions/context-masking/__tests__/fixtures";
import {
  prefetchTuning,
  type RecallClassifier,
  recallSaved,
  recallUnified,
  registerRecallPrefetch,
} from "../extensions/context-masking/recall";
import { userStartEvent } from "../extensions/shared/__tests__/agent-start-events";
import { addClassifierUsage, requestClassifier } from "../lib/classifier";

// Offline recall evaluation. By default there are no model calls: explicit recall is scored on
// lexical ranking and on whether the answer reaches the classifier's candidate pool, and
// prefetch uses a stub that approves every lexical match, so it measures the lexical gate alone.
// `--classifier` reruns both paths through the configured hosted classifier.

export interface RecallArchive {
  tool: string;
  args: Record<string, string>;
  text: string;
}

export type RecallProbeCategory =
  | "identifier"
  | "escaped-json"
  | "duplicate"
  | "superseded"
  | "log"
  | "path"
  | "danish"
  | "distractor"
  /** Shares vocabulary with saved output, passes the lexical gate, but has no answer. */
  | "near-miss";

export interface RecallProbe {
  id: string;
  category: RecallProbeCategory;
  question: string;
  /** Exact substring of the supporting evidence, or null when the session cannot answer. */
  expected: string | null;
  /** A superseded value that must not rank first. */
  stale?: string;
  /** Whether the question is phrased as a user prompt that prefetch sees. */
  prefetch: boolean;
}

const filler = (label: string, lines: number) =>
  Array.from({ length: lines }, (_, i) => `${label} ${i}: ok ${(i * 7919) % 1000}ms`).join("\n");

const scriptOutput = (...items: unknown[]) =>
  [
    "Script completed",
    "Wall time 1.2 seconds",
    "Output:",
    "",
    ...items.flatMap((item, index) => [
      `==> text ${index + 1}/${items.length} <==`,
      JSON.stringify(item),
    ]),
  ].join("\n");

const socketError =
  "error: cannot connect to socket at '/nix/var/nix/daemon-socket/socket': Operation not permitted";

export function recallArchives(): RecallArchive[] {
  return [
    {
      tool: "read",
      args: { path: ".pi/agent/extensions/prompt-ui/context-health.ts" },
      text: [
        'export type ContextHealthColor = "success" | "warning" | "error";',
        "export function contextHealthColor(percent: number): ContextHealthColor {",
        '  if (percent <= 25) return "success";',
        '  if (percent <= 50) return "warning";',
        '  return "error";',
        "}",
        "export function cacheIndicator(percent: number | undefined): ContextIndicator {",
        '  if (percent === undefined) return { text: "", color: "muted" };',
        "  const roundedPercent = Math.round(percent);",
        "  return {",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture reproduces saved source text.
        "    text: `󰆼 ${roundedPercent}%`,",
        '    color: roundedPercent >= 90 ? "muted" : roundedPercent >= 50 ? "warning" : "error",',
        "  };",
        "}",
      ].join("\n"),
    },
    {
      tool: "read",
      args: { path: ".pi/agent/extensions/prompt-ui/context-status.ts" },
      text: [
        "  let cachedInputTokens = 0;",
        "  let totalInputTokens = 0;",
        "  for (const entry of branch) {",
        "    const { input, cacheRead, cacheWrite } = assistant.usage;",
        "    cachedInputTokens += cacheRead;",
        "    totalInputTokens += input + cacheRead + cacheWrite;",
        "  }",
        "  const cachePercent =",
        "    totalInputTokens > 0 ? (cachedInputTokens / totalInputTokens) * 100 : undefined;",
      ].join("\n"),
    },
    {
      tool: "codemode",
      args: { code: 'tools.bash({command:"bun run --cwd .pi/agent sdk:sync"})' },
      text: scriptOutput(
        {
          name: "sdk",
          result: {
            output: `$ bun lib/runtime-sdk.ts\n${socketError}\nCommand failed: nix-store --query --references /nix/store/ankszg-pi\n${socketError}\n\nerror: script "sdk:sync" exited with code 1\n`,
            exit_code: 1,
          },
        },
        {
          name: "lint",
          result: { output: "Checked 4 files in 13ms. No fixes applied.\n", exit_code: 0 },
        },
      ),
    },
    {
      tool: "codemode",
      args: { code: 'tools.bash({command:"bun run --cwd .pi/agent sdk:sync"}) again' },
      text: scriptOutput({
        i: 1,
        result: { output: `$ bun lib/runtime-sdk.ts\n${socketError}\n`, exit_code: 1 },
      }),
    },
    {
      tool: "bash",
      args: { command: "bun run --cwd .pi/agent sdk:check" },
      text: `$ bun lib/runtime-sdk.ts --check\n${socketError}\nerror: script "sdk:check" exited with code 1`,
    },
    {
      tool: "bash",
      args: { command: "bun run --cwd .pi/agent sdk:sync --sdk-root /nix/store/pi-1.4.0" },
      text: "$ bun lib/runtime-sdk.ts --sdk-root /nix/store/pi-1.4.0\nPi SDK 1.4.0: /nix/store/1r89nq-pi-1.4.0/lib/pi/node_modules/@earendil-works/pi-coding-agent",
    },
    {
      tool: "codemode",
      args: { code: 'tools.bash({command:"devenv test"})' },
      text: scriptOutput({
        name: "devenv",
        output:
          "  \u001b[31m×\u001b[0m failed to create devenv home directory: /Users/fbb/.local/share/devenv/\n\u001b[31m   ─▶ \u001b[0mFile exists (os error 17)\n\n",
        exit_code: 1,
      }),
    },
    {
      tool: "codemode",
      args: { code: 'tools.read({path:".pi/agent/settings.json"})' },
      text: scriptOutput({
        name: "classifier settings",
        result: `${filler("setting", 12)}\n  "classifier": {\n    "enabled": true,\n    "providers": [\n      { "provider": "openrouter", "model": "typesafe/jev-1.14" },\n      { "provider": "openrouter", "model": "openai/gpt-6-luna-decisions" }\n    ],\n    "toolDiscovery": { "enabled": true, "timeoutMs": 2400 }\n  },\n${filler("package", 12)}`,
      }),
    },
    {
      tool: "bash",
      args: { command: "bun test extensions/context-masking/__tests__/recall.test.ts" },
      text: [
        filler("(pass) recall case", 30),
        "(fail) clips aggregate passages to the output cap [20.90ms]",
        "error: expect(received).toBe(expected)",
        "Expected: true",
        "Received: false",
        filler("(pass) trailing case", 20),
        " 41 pass",
        " 1 fail",
      ].join("\n"),
    },
    {
      tool: "read",
      args: { path: "docs/decisions/ledger-retention.md" },
      text: "Ledger exporter retention draft: retention_days=30. Status: rejected, superseded by review.",
    },
    {
      tool: "read",
      args: { path: "docs/decisions/ledger-retention-final.md" },
      text: "Ledger exporter approved retention decision: retention_days=106. This number is authoritative.",
    },
    {
      tool: "bash",
      args: { command: "ls .pi/agent/extensions/context-masking/__tests__" },
      text: [
        "artifact-index.test.ts",
        "evidence-archive.test.ts",
        "fixtures.ts",
        "prefetch.test.ts",
        "recall-batch.test.ts",
        "recall-unified.test.ts",
        "recall.test.ts",
      ]
        .map((name) => `.pi/agent/extensions/context-masking/__tests__/${name}`)
        .join("\n"),
    },
    {
      tool: "read",
      args: { path: ".pi/agent/extensions/context-masking/index.ts" },
      text: [
        'import { registerRecall, registerRecallPrefetch } from "./recall";',
        filler("// unrelated setup", 8),
        "export default function contextMasking(pi: ExtensionAPI): void {",
        "  registerRecall(pi);",
        "  registerRecallPrefetch(pi, undefined, (ctx) => loadSettings(ctx).prefetchRecall);",
        "}",
      ].join("\n"),
    },
    {
      tool: "read",
      args: { path: "docs/eksport.md" },
      text: "Udtræk af hovedbogen.\nGodkendt udtræk: skema_æøå_42, erstatter alle kladder.\nKladde: skema_gammel_7 er forkastet.",
    },
    {
      tool: "read",
      args: { path: "README.md" },
      text: "Adapt Pi to your workflows, not the other way around. Customize Pi with extensions, skills, and themes.\nPi ships with powerful defaults but skips features like sub-agents and plan mode. Ask Pi to build what you want.",
    },
    {
      tool: "read",
      args: { path: ".agents/skills/ui-writing/SKILL.md" },
      text: "Improve the wording without changing or misrepresenting the behavior.\nQuality copy names the action. Verify behavior before naming it.\nWhen evidence is missing, identify what must be verified.",
    },
    {
      tool: "read",
      args: { path: "docs/session-boundaries.md" },
      text: "Allowed draft entry types are custom, custom_message, context_edit, and compaction.\nThe complete proposal is validated before it is appended in list order after all handlers finish.",
    },
    {
      tool: "bash",
      args: { command: "bun test extensions/prompt-ui" },
      text: filler("(pass) prompt-ui case", 40),
    },
  ];
}

export function recallProbes(): RecallProbe[] {
  return [
    {
      id: "cache-warning-band",
      category: "identifier",
      question: "Which cache percent thresholds select the warning color?",
      expected: 'roundedPercent >= 50 ? "warning"',
      prefetch: true,
    },
    {
      id: "cache-percent-formula",
      category: "identifier",
      question: "How is the cache percent computed from input tokens?",
      expected: "(cachedInputTokens / totalInputTokens) * 100",
      prefetch: true,
    },
    {
      id: "camel-query",
      category: "identifier",
      question: "Where is registerRecallPrefetch called?",
      expected: "registerRecallPrefetch(pi, undefined,",
      prefetch: false,
    },
    {
      id: "context-bands",
      category: "identifier",
      question: "contextHealthColor warning threshold",
      expected: 'if (percent <= 50) return "warning"',
      prefetch: false,
    },
    {
      id: "nix-socket",
      category: "escaped-json",
      question: "What error did sdk:sync report about the nix daemon socket?",
      expected: "Operation not permitted",
      prefetch: true,
    },
    {
      id: "devenv-home",
      category: "escaped-json",
      question: "Why did devenv fail to create its home directory?",
      expected: "File exists (os error 17)",
      prefetch: true,
    },
    {
      id: "lint-files",
      category: "escaped-json",
      question: "How many files did the lint check cover?",
      expected: "Checked 4 files",
      prefetch: true,
    },
    {
      id: "classifier-fallback",
      category: "escaped-json",
      question: "Which classifier providers and models are configured?",
      expected: "openai/gpt-6-luna-decisions",
      prefetch: true,
    },
    {
      id: "sdk-version",
      category: "duplicate",
      question: "Which Pi SDK version did sdk:sync print with an explicit sdk root?",
      expected: "Pi SDK 1.4.0",
      prefetch: true,
    },
    {
      id: "sdk-check",
      category: "duplicate",
      question: "What did sdk:check exit with?",
      expected: '"sdk:check" exited with code 1',
      prefetch: false,
    },
    {
      id: "retention",
      category: "superseded",
      question: "What retention_days value was approved for the ledger exporter?",
      expected: "retention_days=106",
      stale: "retention_days=30",
      prefetch: true,
    },
    {
      id: "failing-test",
      category: "log",
      question: "Which test failed in the recall suite?",
      expected: "clips aggregate passages to the output cap",
      prefetch: true,
    },
    {
      id: "failing-received",
      category: "log",
      question: "What value did the failing recall test receive?",
      expected: "Received: false",
      prefetch: false,
    },
    {
      id: "prefetch-test-path",
      category: "path",
      question: "Where is the prefetch test file?",
      expected: "__tests__/prefetch.test.ts",
      prefetch: true,
    },
    {
      id: "danish-schema",
      category: "danish",
      question: "Hvilket skema blev godkendt til udtræk?",
      expected: "skema_æøå_42",
      stale: "skema_gammel_7",
      prefetch: true,
    },
    {
      id: "distract-retrieval",
      category: "distractor",
      question: "any way we can improve retrieval quality?",
      expected: null,
      prefetch: true,
    },
    {
      id: "distract-compaction",
      category: "distractor",
      question: "how does compaction affect this?",
      expected: null,
      prefetch: true,
    },
    {
      id: "distract-classifier",
      category: "distractor",
      question: "is recall properly using classifier model?",
      expected: null,
      prefetch: true,
    },
    {
      id: "distract-colorize",
      category: "distractor",
      question: "should we colorize the cache utilization based on lower = worse?",
      expected: null,
      prefetch: true,
    },
    {
      id: "distract-go",
      category: "distractor",
      question: "go ahead",
      expected: null,
      prefetch: true,
    },
    {
      id: "distract-research",
      category: "distractor",
      question: "research if someone else has made something like this that we could learn from",
      expected: null,
      prefetch: true,
    },
    {
      id: "near-payments-retention",
      category: "near-miss",
      question: "What retention_days value was approved for the payments exporter?",
      expected: null,
      prefetch: true,
    },
    {
      id: "near-prompt-ui-failure",
      category: "near-miss",
      question: "Which test failed in the prompt-ui suite?",
      expected: null,
      prefetch: true,
    },
    {
      // Same vocabulary as the ledger exporter decision, different subject. (A ledger schema
      // question is answerable: the Danish note approves skema_æøå_42 for the ledger extract.)
      id: "near-ledger-importer",
      category: "near-miss",
      question: "What retention_days value was approved for the ledger importer?",
      expected: null,
      prefetch: true,
    },
  ];
}

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export async function recallSession(archives: readonly RecallArchive[]) {
  const root = await mkdtemp(join(tmpdir(), "recall-offline-"));
  const manager = SessionManager.inMemory("/work");
  manager.appendMessage({ role: "user", content: "task", timestamp: 0 });
  const dir = join(root, manager.getSessionId());
  await mkdir(dir);
  const items: { path: string; entryId: string; toolName: string }[] = [];
  for (const [index, archive] of archives.entries()) {
    manager.appendMessage({
      role: "assistant",
      content: [
        { type: "toolCall", id: `call${index}`, name: archive.tool, arguments: archive.args },
      ],
      api: "openai-responses",
      provider: "openai",
      model: "m",
      usage,
      stopReason: "toolUse",
      timestamp: 0,
    });
    const entryId = manager.appendMessage({
      role: "toolResult",
      toolCallId: `call${index}`,
      toolName: archive.tool,
      content: [{ type: "text", text: "[masked]" }],
      isError: false,
      timestamp: 0,
    });
    const path = join(dir, `${entryId}.txt`);
    await writeFile(path, archive.text);
    items.push({ path, entryId, toolName: archive.tool });
  }
  manager.appendCustomEntry("context-masking", { items });
  return { root, manager, cleanup: () => rm(root, { recursive: true, force: true }) };
}

export interface ExplicitResult {
  id: string;
  category: RecallProbeCategory;
  hit1: boolean;
  hit3: boolean;
  pool12: boolean;
  stale1: boolean;
  clipped: boolean;
  redundant: number;
}
export interface PrefetchResult {
  id: string;
  category: RecallProbeCategory;
  answerable: boolean;
  injected: boolean;
  answered: boolean;
  chars: number;
}

export async function runRecallEval(
  archives = recallArchives(),
  probes = recallProbes(),
): Promise<{ explicit: ExplicitResult[]; prefetch: PrefetchResult[] }> {
  const session = await recallSession(archives);
  try {
    const branch = session.manager.getBranch();
    const explicit: ExplicitResult[] = [];
    for (const probe of probes) {
      if (probe.expected === null) continue;
      const expected = probe.expected;
      const report = await recallSaved(branch, session.root, probe.question, 3);
      const texts = report.passages.map((passage) => passage.text);
      let pool: string[] = [];
      await recallUnified(
        branch,
        session.root,
        session.manager.getSessionId(),
        [probe.question],
        3,
        {
          classifier: async (input) => {
            const candidates = input.state.text_candidates;
            pool = Array.isArray(candidates)
              ? candidates.map((candidate: { excerpt?: unknown }) =>
                  String(candidate.excerpt ?? ""),
                )
              : [];
            return { ok: false, reason: "request-failure", stage: "request" };
          },
        },
      );
      const containing = texts.filter((text) => text.includes(expected)).length;
      explicit.push({
        id: probe.id,
        category: probe.category,
        hit1: texts[0]?.includes(expected) ?? false,
        hit3: containing > 0,
        pool12: pool.some((text) => text.includes(expected)),
        stale1:
          probe.stale !== undefined &&
          (texts[0]?.includes(probe.stale) ?? false) &&
          !(texts[0]?.includes(expected) ?? false),
        clipped: texts.some((text) => text.includes("[line clipped]")),
        redundant: Math.max(0, containing - 1),
      });
    }

    return { explicit, prefetch: await runPrefetchProbes(session, probes, approveEveryCandidate) };
  } finally {
    await session.cleanup();
  }
}

async function runPrefetchProbes(
  session: Awaited<ReturnType<typeof recallSession>>,
  probes: readonly RecallProbe[],
  classifier: RecallClassifier,
): Promise<PrefetchResult[]> {
  type Handler = (
    event: BeforeAgentStartEvent,
    ctx: ExtensionContext,
  ) => Promise<BeforeAgentStartEventResult | undefined>;
  let handler: Handler | undefined;
  const pi = {
    on: (_name: string, callback: Handler) => {
      handler = callback;
      return () => {};
    },
  };
  // SAFETY: registerRecallPrefetch subscribes exactly one before_agent_start handler via `on`.
  registerRecallPrefetch(
    pi as unknown as Pick<ExtensionAPI, "on">,
    () => session.root,
    () => true,
    {
      classifier,
    },
  );
  // SAFETY: with an injected classifier, prefetch reads only ctx.sessionManager.
  const ctx = { sessionManager: session.manager } as unknown as ExtensionContext;
  const prefetch: PrefetchResult[] = [];
  for (const probe of probes) {
    if (!probe.prefetch || !handler) continue;
    const result = await handler(userStartEvent(probe.question), ctx);
    const content = typeof result?.message?.content === "string" ? result.message.content : "";
    prefetch.push({
      id: probe.id,
      category: probe.category,
      answerable: probe.expected !== null,
      injected: content.length > 0,
      answered: probe.expected !== null && content.includes(probe.expected),
      chars: content.length,
    });
  }
  return prefetch;
}

export function summarizeRecallEval(result: Awaited<ReturnType<typeof runRecallEval>>) {
  const rate = (values: readonly boolean[]) =>
    values.length === 0 ? 0 : values.filter(Boolean).length / values.length;
  const answerable = result.prefetch.filter((row) => row.answerable);
  const distractors = result.prefetch.filter((row) => row.category === "distractor");
  return {
    explicitProbes: result.explicit.length,
    hit1: rate(result.explicit.map((row) => row.hit1)),
    hit3: rate(result.explicit.map((row) => row.hit3)),
    candidateRecall12: rate(result.explicit.map((row) => row.pool12)),
    stale1: result.explicit.filter((row) => row.stale1).length,
    clippedPassages: result.explicit.filter((row) => row.clipped).length,
    redundantSlots: result.explicit.reduce((sum, row) => sum + row.redundant, 0),
    prefetchAnswered: rate(answerable.map((row) => row.answered)),
    // With the stub approving everything, these count distractors that reach the classifier;
    // the live run checks that the classifier then rejects them.
    distractorsPastLexicalGate: distractors.filter((row) => row.injected).length,
    prefetchDistractors: distractors.length,
    nearMissesPastLexicalGate: result.prefetch.filter(
      (row) => row.category === "near-miss" && row.injected,
    ).length,
    prefetchChars: result.prefetch.reduce((sum, row) => sum + row.chars, 0),
  };
}

export interface ClassifierMeter {
  classify: RecallClassifier;
  readonly calls: number;
  readonly failures: Readonly<Record<string, number>>;
  readonly latenciesMs: readonly number[];
  readonly usage: Usage | undefined;
}

export function meterClassifier(classify: RecallClassifier): ClassifierMeter {
  const failures: Record<string, number> = {};
  const latenciesMs: number[] = [];
  let calls = 0;
  let usage: Usage | undefined;
  return {
    classify: async (input, options) => {
      calls++;
      const started = performance.now();
      try {
        const result = await classify(input, options);
        usage = addClassifierUsage(usage, result.usage);
        if (!result.ok) failures[result.reason] = (failures[result.reason] ?? 0) + 1;
        return result;
      } catch (error) {
        failures.thrown = (failures.thrown ?? 0) + 1;
        throw error;
      } finally {
        latenciesMs.push(performance.now() - started);
      }
    },
    get calls() {
      return calls;
    },
    failures,
    latenciesMs,
    get usage() {
      return usage;
    },
  };
}

export interface LiveExplicitResult {
  id: string;
  category: RecallProbeCategory;
  answerable: boolean;
  answered: boolean;
  abstained: boolean;
  /** Returned passages carry the classifier's "may not answer" label. */
  labelled: boolean;
  stale: boolean;
  rankingSource: "classifier" | "lexical";
  fallbackReason?: string;
}

/** Runs explicit recall and prefetch through `classify`, scoring answers and abstentions. */
export async function runLiveRecallEval(
  classify: RecallClassifier,
  archives = recallArchives(),
  probes = recallProbes(),
): Promise<{ explicit: LiveExplicitResult[]; prefetch: PrefetchResult[] }> {
  const session = await recallSession(archives);
  try {
    const branch = session.manager.getBranch();
    const explicit: LiveExplicitResult[] = [];
    for (const probe of probes) {
      const report = await recallUnified(
        branch,
        session.root,
        session.manager.getSessionId(),
        [probe.question],
        3,
        { classifier: classify },
      );
      const content = report.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("\n");
      const answerable = probe.expected !== null;
      explicit.push({
        id: probe.id,
        category: probe.category,
        answerable,
        answered: answerable && content.includes(probe.expected ?? ""),
        abstained: report.textMatches === 0,
        labelled: content.includes("Closest saved passage;"),
        // Superseded text beside the answer is context; stale means it is returned without it.
        stale:
          probe.stale !== undefined &&
          content.includes(probe.stale) &&
          !content.includes(probe.expected ?? ""),
        rankingSource: report.rankingSource,
        ...(report.fallbackReason === undefined ? {} : { fallbackReason: report.fallbackReason }),
      });
    }
    return { explicit, prefetch: await runPrefetchProbes(session, probes, classify) };
  } finally {
    await session.cleanup();
  }
}

export function summarizeLiveRecallEval(
  result: Awaited<ReturnType<typeof runLiveRecallEval>>,
  meter: ClassifierMeter,
) {
  const rate = (values: readonly boolean[]) =>
    values.length === 0 ? 0 : values.filter(Boolean).length / values.length;
  const answerable = result.explicit.filter((row) => row.answerable);
  const unanswerable = result.explicit.filter((row) => !row.answerable);
  const prefetchAnswerable = result.prefetch.filter((row) => row.answerable);
  const latencies = [...meter.latenciesMs].sort((a, b) => a - b);
  const percentile = (p: number) =>
    latencies.length === 0
      ? 0
      : Math.round(
          latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))] ?? 0,
        );
  return {
    explicitAnswered: rate(answerable.map((row) => row.answered)),
    explicitAnswerable: answerable.length,
    explicitAbstainedOnUnanswerable: rate(unanswerable.map((row) => row.abstained)),
    // Unanswerable queries that returned passages: share labelled as possibly not answering.
    explicitLabelledWhenUnanswerable: rate(
      unanswerable.filter((row) => !row.abstained).map((row) => row.labelled),
    ),
    // Answered queries wrongly labelled as possibly not answering.
    explicitLabelledWhenAnswered: answerable.filter((row) => row.answered && row.labelled).length,
    explicitUnanswerable: unanswerable.length,
    explicitStale: result.explicit.filter((row) => row.stale).length,
    explicitLexicalFallbacks: result.explicit.filter((row) => row.rankingSource === "lexical")
      .length,
    prefetchAnswered: rate(prefetchAnswerable.map((row) => row.answered)),
    prefetchAnswerable: prefetchAnswerable.length,
    prefetchInjectedOnDistractor: result.prefetch.filter(
      (row) => row.category === "distractor" && row.injected,
    ).length,
    prefetchInjectedOnNearMiss: result.prefetch.filter(
      (row) => row.category === "near-miss" && row.injected,
    ).length,
    prefetchNearMisses: result.prefetch.filter((row) => row.category === "near-miss").length,
    classifierCalls: meter.calls,
    classifierFailures: meter.failures,
    latencyMsP50: percentile(0.5),
    latencyMsP90: percentile(0.9),
    latencyMsMax: Math.round(latencies.at(-1) ?? 0),
    inputTokens: meter.usage?.input ?? 0,
    outputTokens: meter.usage?.output ?? 0,
    costUsd: meter.usage?.cost.total ?? 0,
  };
}

if (import.meta.main) {
  const tuning = (name: string) => {
    const index = process.argv.indexOf(name);
    const value = index < 0 ? undefined : Number(process.argv[index + 1]);
    if (value !== undefined && !Number.isFinite(value)) throw new Error(`${name} needs a number`);
    return value;
  };
  prefetchTuning.coverage = tuning("--prefetch-coverage") ?? prefetchTuning.coverage;
  prefetchTuning.margin = tuning("--prefetch-margin") ?? prefetchTuning.margin;
  if (process.argv.includes("--classifier")) {
    const runtime = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
    const registry = new ModelRegistry(runtime);
    const meter = meterClassifier((input, options) =>
      requestClassifier(registry, input, {
        ...options,
        settingsContext: { cwd: process.cwd(), isProjectTrusted: () => false },
      }),
    );
    const result = await runLiveRecallEval(meter.classify);
    console.table(result.explicit);
    console.table(result.prefetch);
    console.log(JSON.stringify(summarizeLiveRecallEval(result, meter), null, 2));
  } else {
    const result = await runRecallEval();
    console.table(result.explicit);
    console.table(result.prefetch);
    console.log(JSON.stringify(summarizeRecallEval(result), null, 2));
  }
}
