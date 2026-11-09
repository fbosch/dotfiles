import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  type BeforeAgentStartEvent,
  type BeforeAgentStartEventResult,
  type ExtensionAPI,
  type ExtensionContext,
  ModelRegistry,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { registerRecallPrefetch } from "../extensions/context-masking/recall";
import { userStartEvent } from "../extensions/shared/__tests__/agent-start-events";
import { requestClassifier } from "../lib/classifier";
import { compactedFactCorpus, evidencePresent } from "./context-compacted-fact-fixtures";
import { recallSession } from "./context-recall-offline";

export async function runPrefetchRevisions(repeats: number) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "prefetch-revisions-")));
  const corpus = compactedFactCorpus("diverse-scale-5", "diverse");
  const target = corpus.facts[153];
  if (!target?.previous) throw new Error("Missing recorded revision challenge");
  const pair = corpus.archives.filter((archive) => archive.text.includes(target.entity));
  if (pair.length !== 2) throw new Error("Expected two revision snapshots");
  const batch =
    [250, 555, 851, 156, 652, 757, 153, 608]
      .map((index) => {
        const fact = corpus.facts[index];
        if (!fact) throw new Error("Missing recorded batch member");
        return `- fact_${index}: ${fact.question}`;
      })
      .join("\n") +
    "\n- unknown_field: What signing key was approved for service svcajqq?" +
    "\n- unknown_event: Who won the Copenhagen chess tournament?";
  const cases = [
    {
      name: "recorded-batch-latest",
      archives: corpus.archives,
      prompt: batch,
      expected: target.value,
      rejected: target.previous,
    },
    {
      name: "minimal-latest",
      archives: pair,
      prompt: target.question,
      expected: target.value,
      rejected: target.previous,
    },
    {
      name: "historical-initial",
      archives: pair,
      prompt: `What expiry_date was approved for service ${target.entity} in revision 1, before it was superseded?`,
      expected: target.previous,
      rejected: target.value,
    },
    {
      name: "later-read-of-old-revision",
      archives: [...pair].reverse(),
      prompt: target.question,
      expected: target.value,
      rejected: target.previous,
    },
  ];
  const runtime = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
  const classify = runtime.classify.bind(runtime);
  const models = new Map<string, { model: string; calls: number; failures: number }>();
  runtime.classify = async (model, input, options) => {
    const key = `${model.provider}/${model.id}`;
    const row = models.get(key) ?? { model: key, calls: 0, failures: 0 };
    models.set(key, row);
    row.calls++;
    try {
      const result = await classify(model, input, options);
      if (result.stopReason !== "stop") row.failures++;
      return result;
    } catch (error) {
      row.failures++;
      throw error;
    }
  };
  const registry = new ModelRegistry(runtime);
  const rows: Array<{
    scenario: string;
    iteration: number;
    correct: boolean;
    staleOrWrongRevision: boolean;
    injected: boolean;
    requestBytes: number;
    classifierFailure?: string;
  }> = [];
  for (const scenario of cases) {
    // Post-compaction records in the failure have only the tool label, not original arguments.
    const session = await recallSession(
      scenario.archives.map((archive) => ({ ...archive, args: {} })),
    );
    try {
      for (let iteration = 0; iteration < repeats; iteration++) {
        type Handler = (
          event: BeforeAgentStartEvent,
          ctx: ExtensionContext,
        ) => Promise<BeforeAgentStartEventResult | undefined>;
        let handler: Handler | undefined;
        let requestBytes = 0;
        let classifierFailure: string | undefined;
        const requests: unknown[] = [];
        // SAFETY: registerRecallPrefetch subscribes only one before_agent_start handler through on.
        registerRecallPrefetch(
          {
            on: (_name: string, callback: Handler) => {
              handler = callback;
            },
          } as unknown as Pick<ExtensionAPI, "on">,
          () => session.root,
          () => true,
          {
            classifier: async (input, options) => {
              requestBytes += Buffer.byteLength(JSON.stringify(input));
              const response = await requestClassifier(registry, input, {
                ...options,
                settingsContext: { cwd: process.cwd(), isProjectTrusted: () => false },
              });
              requests.push({ input, response });
              if (!response.ok) classifierFailure = response.reason;
              return response;
            },
          },
        );
        if (!handler) throw new Error("Missing production prefetch hook");
        // SAFETY: injected root, enablement, and classifier callbacks leave only sessionManager in use.
        const result = await handler(userStartEvent(scenario.prompt), {
          sessionManager: session.manager,
        } as unknown as ExtensionContext);
        const text = typeof result?.message?.content === "string" ? result.message.content : "";
        const row = {
          scenario: scenario.name,
          iteration,
          correct: evidencePresent(text, { entity: target.entity, value: scenario.expected }),
          staleOrWrongRevision: evidencePresent(text, {
            entity: target.entity,
            value: scenario.rejected,
          }),
          injected: text.length > 0,
          requestBytes,
          ...(classifierFailure === undefined ? {} : { classifierFailure }),
        };
        rows.push(row);
        await writeFile(
          join(root, `${scenario.name}-${iteration}.json`),
          JSON.stringify({ row, requests, result }, null, 2),
          { mode: 0o600 },
        );
      }
    } finally {
      await session.cleanup();
    }
  }
  const summaries = cases.map((scenario) => {
    const group = rows.filter((row) => row.scenario === scenario.name);
    return {
      scenario: scenario.name,
      trials: group.length,
      correctOnly: group.filter((row) => row.correct && !row.staleOrWrongRevision).length,
      wrongRevision: group.filter((row) => row.staleOrWrongRevision).length,
      abstained: group.filter((row) => !row.injected).length,
      classifierFailures: group.filter((row) => row.classifierFailure !== undefined).length,
      maxRequestBytes: Math.max(...group.map((row) => row.requestBytes)),
    };
  });
  const passed = summaries.every((summary) => summary.correctOnly === summary.trials);
  const report = {
    root,
    passed,
    repeats,
    entity: target.entity,
    current: target.value,
    previous: target.previous,
    summaries,
    rows,
    models: [...models.values()],
  };
  await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  return report;
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      run: { type: "boolean", default: false },
      repeats: { type: "string", default: "10" },
    },
  });
  const repeats = Number(values.repeats);
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 30)
    throw new Error("Repeats must be between 1 and 30");
  if (!values.run)
    console.log(
      JSON.stringify({ modelCalls: 0, repeats, cases: 4, plannedClassifierCalls: repeats * 4 }),
    );
  else {
    const report = await runPrefetchRevisions(repeats);
    console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
    if (!report.passed) process.exitCode = 1;
  }
}
