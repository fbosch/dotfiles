import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Usage } from "@earendil-works/pi-ai";
import {
  ModelRegistry,
  ModelRuntime,
  type SessionEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { isMatching, P } from "ts-pattern";
import { buildIndex } from "../extensions/context-masking/artifact-index";
import { packCheckpoint } from "../extensions/context-masking/checkpoint-packing";
import {
  EXTRACTIVE_HEADER,
  expandCheckpointSources,
} from "../extensions/context-masking/checkpoint-sources";
import {
  readTextArchiveReference,
  readTextArtifact,
  savedItems,
} from "../extensions/context-masking/evidence-archive";
import {
  type RecallClassifier,
  recallSaved,
  recallSavedBatch,
  recallUnified,
} from "../extensions/context-masking/recall";
import { requestClassifier } from "../lib/classifier";
import { autonomousProbe } from "./context-classifier-autonomous-agent";
import { recallFixture } from "./context-classifier-recall-fixtures";
import {
  meterClassifier,
  recallSession,
  runLiveRecallEval,
  runRecallEval,
  summarizeLiveRecallEval,
  summarizeRecallEval,
} from "./context-recall-offline";

const BENCHMARK_DIR = dirname(fileURLToPath(import.meta.url));
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
function parseProbes(text: string, source: string): RecordedProbe[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new Error(`Invalid JSON in ${source}`, { cause });
  }
  if (!isMatching(P.array(RecordedProbePattern), value)) throw Error("Invalid recorded probes");
  return value;
}
const RecordedProbePattern = {
  id: P.string,
  sessionFile: P.string,
  question: P.string,
  expected: P.string,
  sourcePath: P.string,
};
export interface RecordedProbe {
  id: string;
  sessionFile: string;
  question: string;
  expected: string;
  sourcePath: string;
}

export function scoreAnswer(
  answer: string,
  probes: readonly { id: string; expected: string | null }[],
) {
  let values: unknown;
  try {
    values = JSON.parse(answer);
  } catch {
    values = undefined;
  }
  return probes.map((probe) => ({
    id: probe.id,
    correct:
      isMatching(P.record(P.string, P.union(P.string, null)), values) &&
      Object.hasOwn(values, probe.id) &&
      values[probe.id] === probe.expected,
  }));
}

export async function readSavedLines(
  branch: readonly SessionEntry[],
  root: string,
  path: string,
  offset: number,
  limit: number,
) {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200
  )
    throw Error("Invalid saved read range");
  const saved = await readTextArchiveReference(root, savedItems(branch), path, 64_000);
  return saved.text
    .split("\n")
    .slice(offset - 1, offset - 1 + limit)
    .map((line, index) => `${offset + index}│${line}`)
    .join("\n");
}
export async function recordedBaseline(probes: readonly RecordedProbe[], artifactRoot: string) {
  const results = [];
  for (const sessionFile of new Set(probes.map((probe) => probe.sessionFile))) {
    // Read-only: never resume or append to the user's recorded sessions.
    const manager = SessionManager.open(sessionFile);
    const branch = manager.getBranch();
    const records = savedItems(branch);
    const cases = probes.filter((probe) => probe.sessionFile === sessionFile);
    const rows = [];
    for (const probe of cases) {
      const source = [...records.values()].find((record) => record.path === probe.sourcePath);
      if (!source) throw Error(`${probe.id}: expected source is not in the session catalogue`);
      const artifact = await readTextArtifact(artifactRoot, source, 4_000_000);
      if (artifact.partial || !artifact.text.includes(probe.expected))
        throw Error(`${probe.id}: expected evidence was not verified in the complete source`);
      const report = await recallSaved(branch, artifactRoot, probe.question, 3);
      rows.push({
        id: probe.id,
        question: probe.question,
        expected: probe.expected,
        sourcePath: probe.sourcePath,
        sourceSha256: digest(artifact.text),
        hit1: report.passages[0]?.text.includes(probe.expected) ?? false,
        hit3: report.passages.some((passage) => passage.text.includes(probe.expected)),
        expectedSourceCited: report.passages.some((passage) => passage.path === probe.sourcePath),
        scanned: report.scanned,
        skipped: report.skipped,
        limited: report.limited,
        outputChars: report.text.length,
        citations: report.passages.map(({ path, from, to }) => ({ path, from, to })),
      });
    }
    const batches = [];
    for (let i = 0; i < cases.length; i += 8) {
      const group = cases.slice(i, i + 8);
      const report = await recallSavedBatch(
        branch,
        artifactRoot,
        group.map((probe) => probe.question),
        3,
      );
      batches.push({
        hits: group.map((probe, index) => ({
          id: probe.id,
          hit:
            report.queries[index]?.passages.some((passage) =>
              passage.text.includes(probe.expected),
            ) ?? false,
        })),
        scanned: report.scanned,
        skipped: report.skipped,
        limited: report.limited,
        outputChars: report.text.length,
      });
    }
    const latest = [...branch].reverse().find((entry) => entry.type === "compaction");
    let expansion: { supported: boolean; sources?: number; error?: string } = { supported: false };
    if (latest?.type === "compaction") {
      try {
        const expanded = await expandCheckpointSources(latest.summary, records, artifactRoot, {
          windowBytes: 4_000_000,
          totalBytes: 4_000_000,
        });
        expansion = { supported: expanded !== undefined, sources: expanded?.sources.length ?? 0 };
      } catch (error) {
        expansion = {
          supported: true,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    results.push({
      sessionFile,
      sessionId: manager.getSessionId(),
      sessionSha256: digest(await readFile(sessionFile, "utf8")),
      catalogueSize: records.size,
      rows,
      batches,
      expansion,
    });
  }
  return results;
}

async function sourceHashes() {
  const dir = join(BENCHMARK_DIR, "../extensions/context-masking");
  const hashes: Record<string, string> = {};
  for (const file of (await readdir(dir)).filter((file) => file.endsWith(".ts")).sort())
    hashes[file] = digest(await readFile(join(dir, file), "utf8"));
  return hashes;
}

async function agentBaseline(
  runtime: ModelRuntime,
  modelName: string,
  repeats: number,
  classifier: RecallClassifier,
  memoryMode: "index" | "checkpoint" | "arguments",
) {
  const slash = modelName.indexOf("/");
  const model = runtime.getModel(modelName.slice(0, slash), modelName.slice(slash + 1));
  if (!model) throw Error(`Agent model unavailable: ${modelName}`);
  const callArgs = {
    code: `const approval_token = "approved_æøå";\n${Array.from({ length: 24 }, (_, i) => `const detail_${i} = ${i};`).join("\n")}\nreturn approval_token;`,
  };
  const fixture = recallFixture("context-footprint-baseline-v1");
  if (memoryMode === "arguments") {
    fixture.goal = "Recover the original codemode arguments without running the script.";
    fixture.outputs = ["Recorded operation returned approved_æøå."];
    fixture.probes = [
      {
        id: "arguments",
        category: "surprise",
        source: "read",
        expected: JSON.stringify(callArgs),
        question:
          "As one string, what exact JSON argument object was supplied to the codemode call whose script set approval_token to approved_æøå? Include the complete code, not only the token.",
      },
    ];
  }
  const session = await recallSession(
    fixture.outputs.map((text, index) => ({
      tool: memoryMode === "arguments" ? "codemode" : "read",
      args: memoryMode === "arguments" ? callArgs : { path: `reports/source-${index}.txt` },
      text,
    })),
  );
  try {
    let branch = session.manager.getBranch();
    let memory: string | undefined;
    if (memoryMode !== "index") {
      const packed = await packCheckpoint(
        [
          { text: EXTRACTIVE_HEADER },
          ...(memoryMode === "arguments"
            ? [{ reference: "r0", text: `[tool call codemode] ${JSON.stringify(callArgs)}` }]
            : []),
          ...[...savedItems(branch).values()].map((record, index) => ({
            reference: `r${index}`,
            text: `[saved tool output]: ${record.path}`,
          })),
        ],
        1000,
        session.root,
        session.manager.getSessionId(),
      );
      if (!packed.fits) throw Error("Synthetic checkpoint did not fit");
      if (
        memoryMode === "arguments" &&
        !packed.savedItems.some((record) => record.toolName === "compaction:calls")
      )
        throw Error("Exact-argument probe did not exercise an argument archive");
      session.manager.appendCustomEntry("context-masking", { items: packed.savedItems });
      branch = session.manager.getBranch();
      memory = packed.text;
    } else memory = buildIndex(branch, new Set(), existsSync);
    if (!memory) throw Error("Synthetic agent memory is missing");
    const rows = [];
    for (let repeat = 0; repeat < repeats; repeat++) {
      for (const mode of ["lexical", "classifier"] as const) {
        const calls: Array<{ stopReason: string; usage: Usage }> = [];
        const result = await autonomousProbe(
          fixture,
          memory,
          async (context) => {
            const response = await runtime.completeSimple(model, context, { maxTokens: 1_200 });
            calls.push({ stopReason: response.stopReason, usage: response.usage });
            if (response.stopReason === "error" || response.stopReason === "aborted")
              throw Error(response.errorMessage ?? response.stopReason);
            return response;
          },
          async (query, limit) => {
            if (mode === "lexical") return recallSaved(branch, session.root, query, limit);
            const report = await recallUnified(
              branch,
              session.root,
              session.manager.getSessionId(),
              [query],
              limit,
              { classifier },
            );
            return {
              text: report.content
                .flatMap((block) => (block.type === "text" ? [block.text] : []))
                .join("\n"),
              limited: report.limited,
              skipped: report.skipped,
            };
          },
          undefined,
          memoryMode === "arguments"
            ? (path, offset, limit) => readSavedLines(branch, session.root, path, offset, limit)
            : undefined,
        );
        rows.push({
          repeat,
          mode,
          scores: scoreAnswer(result.answer, fixture.probes),
          answer: result.answer,
          events: result.events,
          calls,
          turns: result.turns,
          toolCalls: result.toolCalls,
          exhausted: result.exhausted,
          maxContextBytes: result.maxContextBytes,
          ...(memoryMode === "arguments" ? { transcript: result.messages } : {}),
        });
      }
    }
    return {
      model: modelName,
      memoryMode,
      seed: "context-footprint-baseline-v1",
      probes: fixture.probes,
      memorySha256: digest(memory),
      rows,
    };
  } finally {
    await session.cleanup();
  }
}

async function main() {
  const arg = (name: string) => {
    const index = process.argv.indexOf(name);
    return index < 0 ? undefined : process.argv[index + 1];
  };
  const output = arg("--output");
  if (!output) throw Error("Pass --output with a fresh private result directory");
  const repeats = Number(arg("--repeats") ?? 3);
  if (!Number.isSafeInteger(repeats) || repeats < 1 || repeats > 10)
    throw Error("Invalid --repeats");
  const modelName = arg("--model");
  const memoryMode = arg("--agent-memory") ?? "index";
  if (memoryMode !== "index" && memoryMode !== "checkpoint" && memoryMode !== "arguments")
    throw Error("Invalid --agent-memory");
  if (process.argv.includes("--agent") && !modelName?.includes("/"))
    throw Error("--agent requires --model provider/model");
  await mkdir(output, { recursive: false, mode: 0o700 });
  const save = async (name: string, data: unknown) =>
    writeFile(join(output, name), `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  const before = await sourceHashes();
  await save("metadata.json", {
    schema: 1,
    createdAt: new Date().toISOString(),
    repeats,
    model: modelName ?? null,
    sourceHashes: before,
    runtimeModule: import.meta.resolve("@earendil-works/pi-coding-agent"),
    argv: process.argv.slice(2),
    scope:
      "Recorded sessions stay local. Hosted classifier and agent probes are synthetic only. Agent trials exercise index discovery and recall, not the full Pi extension lifecycle.",
  });
  const offline = await runRecallEval();
  await save("offline.json", { result: offline, summary: summarizeRecallEval(offline) });
  const recorded = arg("--recorded");
  if (recorded) {
    const probes = parseProbes(await readFile(recorded, "utf8"), recorded);
    await save("recorded-probes.json", probes);
    await save(
      "recorded.json",
      await recordedBaseline(
        probes,
        resolve(arg("--artifact-root") ?? join(BENCHMARK_DIR, "../cache/context-masking")),
      ),
    );
  }
  if (process.argv.includes("--live")) {
    const runtime = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
    const registry = new ModelRegistry(runtime);
    const meter = meterClassifier((input, options) =>
      requestClassifier(registry, input, {
        ...options,
        settingsContext: { cwd: process.cwd(), isProjectTrusted: () => false },
      }),
    );
    for (let repeat = 0; repeat < repeats; repeat++) {
      const result = await runLiveRecallEval(meter.classify);
      await save(`classifier-${repeat}.json`, {
        result,
        cumulative: summarizeLiveRecallEval(result, meter),
      });
    }
    if (process.argv.includes("--agent") && modelName)
      await save(
        "agent.json",
        await agentBaseline(runtime, modelName, repeats, meter.classify, memoryMode),
      );
    await save("classifier-usage.json", {
      calls: meter.calls,
      failures: meter.failures,
      usage: meter.usage,
    });
  } else if (process.argv.includes("--agent")) throw Error("--agent requires --live");
  const after = await sourceHashes();
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw Error("Extension sources changed during baseline");
  await save("complete.json", { complete: true, sourceHashesUnchanged: true });
  console.log(output);
}

if (import.meta.main)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
