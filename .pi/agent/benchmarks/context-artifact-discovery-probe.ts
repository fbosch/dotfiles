import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { run, scoreRun } from "./context-masking-recall-probe";
import { type Arm, buildHistory, history, questions } from "./context-pruning-recall";

// Isolates artifact discovery from classifier quality: freeze the ranking measured in the
// pruning pilot, and pair both arms on the same synthetic history and recall questions.
const SCORES = [0.133, 0.818, 0.115, 0.862, 0.085, 0.132, 0.113, 0.13];

async function main() {
  const [model = "vercel-ai-gateway/openai/gpt-4.1-mini", casesArg = "diagnosis,surprise,control"] =
    process.argv.slice(2);
  const gap = Number(process.env.PROBE_GAP_MS ?? "35000");
  if (!Number.isFinite(gap) || gap < 0) throw new Error("Invalid PROBE_GAP_MS");
  const root = await mkdtemp(join(tmpdir(), "artifact-discovery-probe-"));
  const observer = join(root, "observer.ts");
  // Capture only presence flags, never credentials, headers, or request contents.
  await writeFile(
    observer,
    `
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function (pi: ExtensionAPI) {
  pi.on("before_provider_request", async (event, ctx) => {
    const payload = JSON.stringify(event.payload);
    await appendFile(join(ctx.cwd, "wire.jsonl"), JSON.stringify({
      pointers: payload.includes("/saved/"),
      index: payload.includes("Saved tool results:"),
      toolNames: Array.isArray(event.payload.tools) ? event.payload.tools.map((tool) => tool.name ?? tool.function?.name) : [],
    }) + "\\n");
  });
}
`,
  );

  const placement = process.env.PROBE_INDEX_PLACEMENT ?? "prefix";
  if (placement !== "prefix" && placement !== "tail") throw new Error("Invalid index placement");
  const recallEnabled = process.env.PROBE_RECALL === "1";
  const experiment = join(root, "experimental-index.ts");
  const indexModule = JSON.stringify(
    join(import.meta.dir, "../extensions/context-masking/artifact-index.ts"),
  );
  // Keep the failed candidate reproducible without loading it into production sessions.
  await writeFile(
    experiment,
    `
import { existsSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildIndex } from ${indexModule};
export default function (pi: ExtensionAPI) {
  pi.on("context", (event, ctx) => {
    const saved = buildIndex(ctx.sessionManager.getBranch(), new Set(), existsSync);
    if (!saved) return;
    const lines = saved.split("\\n");
    lines[0] = "[context-masking] Saved tool results: original call → exact saved output. For questions about earlier output, read the saved path below, not the original source; the source may have changed or disappeared. Use offset and limit for long output.";
    const at = ${JSON.stringify(placement)} === "tail" ? event.messages.length - 1
      : event.messages.findIndex((message) => message.role === "user") + 1;
    return { messages: [...event.messages.slice(0, at), {
      role: "custom", customType: "experimental-discovery-index",
      content: lines.join("\\n"), display: false, timestamp: 0,
    }, ...event.messages.slice(at)] };
  });
}
`,
  );
  const retrieval = join(root, "recall-extension.ts");
  await writeFile(
    retrieval,
    `
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerRecall, registerRecallPrefetch } from ${JSON.stringify(join(import.meta.dir, "../extensions/context-masking/recall.ts"))};
export default function (pi: ExtensionAPI) {
  registerRecall(pi, (ctx) => join(dirname(ctx.cwd), "saved"));
  if (process.env.PROBE_PREFETCH === "1") registerRecallPrefetch(pi, (ctx) => join(dirname(ctx.cwd), "saved"));
}
`,
  );
  const h = history();
  const jobs: { case: string; arm: Arm; target: number }[] = [
    { case: "diagnosis", arm: "deterministic", target: 1 },
    { case: "surprise", arm: "classifier", target: 4 },
    { case: "control", arm: "deterministic", target: 0 },
  ];
  const results = [];
  let finished = 0;
  const selected = casesArg.split(",");
  if (selected.some((name) => !jobs.some((job) => job.case === name)))
    throw new Error("Unknown case");
  for (const job of jobs.filter((job) => selected.includes(job.case))) {
    for (const indexed of [false, true]) {
      const wait = gap - (performance.now() - finished);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      const probe = questions(h).find((p) => p.name === job.case);
      if (!probe) throw new Error("Missing probe");
      const built = await buildHistory(
        h,
        job.arm,
        SCORES,
        join(root, `${job.case}-${indexed ? "index" : "baseline"}`),
      );
      const before = (await readFile(built.sessionFile, "utf8")).trim().split("\n").length;
      const started = performance.now();
      const result = await run(
        process.env.PI_BIN ?? "pi",
        [
          "-p",
          "-ne",
          "-e",
          observer,
          ...(indexed ? ["-e", recallEnabled ? retrieval : experiment] : []),
          "-ns",
          "-np",
          "-nc",
          "--no-mcp",
          "--tools",
          indexed && recallEnabled ? "read,recall" : "read",
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
      const ms = performance.now() - started;
      finished = performance.now();
      const appended: SessionEntry[] = (await readFile(built.sessionFile, "utf8"))
        .trim()
        .split("\n")
        .slice(before)
        .map((line) => JSON.parse(line));
      const usage = appended.flatMap((entry) =>
        entry.type === "message" && entry.message.role === "assistant" ? [entry.message.usage] : [],
      );
      const wire = (await readFile(join(built.cwd, "wire.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const row = {
        case: job.case,
        arm: job.arm,
        indexed,
        recallEnabled: indexed && recallEnabled,
        prefetched: appended.some(
          (e) => e.type === "custom_message" && e.customType === "context-masking-recall",
        ),
        prefetchContainedAnswer: appended.some(
          (e) =>
            e.type === "custom_message" &&
            e.customType === "context-masking-recall" &&
            typeof e.content === "string" &&
            e.content.includes(probe.answer),
        ),
        recallCalls: appended
          .flatMap((e) =>
            e.type === "message" && e.message.role === "assistant" ? e.message.content : [],
          )
          .filter((b) => b.type === "toolCall" && b.name === "recall").length,
        recalledViaSearch: appended.some(
          (e) =>
            e.type === "message" &&
            e.message.role === "toolResult" &&
            e.message.toolName === "recall" &&
            e.message.content.some((b) => b.type === "text" && b.text.includes(probe.answer)),
        ),
        exit: result.code,
        error: result.stderr,
        ...scoreRun(appended, probe, built.artifacts[job.target] ?? ""),
        ms,
        initialPromptTokens: usage[0]
          ? usage[0].input + usage[0].cacheRead + usage[0].cacheWrite
          : 0,
        cumulativeInputTokens: usage.reduce(
          (sum, u) => sum + u.input + u.cacheRead + u.cacheWrite,
          0,
        ),
        wire,
      };
      results.push(row);
      console.error(JSON.stringify(row));
      await writeFile(
        join(root, "results.json"),
        JSON.stringify({ root, model, results }, null, 2),
      );
      if (result.code !== 0) throw new Error(`Probe failed: ${result.stderr}; evidence: ${root}`);
    }
  }
  console.log(JSON.stringify({ root, model, results }, null, 2));
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
