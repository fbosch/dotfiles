import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { CLASSIFIER_DEFAULTS, type ClassifierRequest } from "../extensions/context-masking/classifier-compaction";
import type { NativeContext } from "./context-classifier-autonomous-agent";

export interface CallMetric { kind: string; ms: number; input: number; output: number; cost: number; }
export async function autonomousClient(root: string) {
  const runtime = await ModelRuntime.create();
  const model = runtime.getModel("vercel-ai-gateway", "openai/gpt-4.1-mini");
  const classifier = runtime.getModelOfType("classifier", CLASSIFIER_DEFAULTS.provider, CLASSIFIER_DEFAULTS.model);
  if (!model || !classifier) throw new Error("Autonomous recall models unavailable");
  const gap = Number(process.env.COMPACTION_CHAT_GAP_MS ?? "15000");
  if (!Number.isFinite(gap) || gap < 0) throw new Error("Invalid chat gap");
  const calls: CallMetric[] = [];
  let last = -Infinity, waitedMs = 0;
  const save = async () => writeFile(join(root, "calls.json"), JSON.stringify(calls, null, 2));
  const complete = async (context: NativeContext, kind: string, metrics: CallMetric[]) => {
    const pause = gap - (performance.now() - last);
    if (pause > 0) {
      const start = performance.now();
      await new Promise((resolve) => setTimeout(resolve, pause));
      waitedMs += performance.now() - start;
    }
    last = performance.now();
    const start = performance.now();
    const result = await runtime.completeSimple(model, context, { maxTokens: kind === "summary" ? 900 : 1_200 });
    const u = result.usage;
    const metric = { kind, ms: performance.now() - start, input: u.input + u.cacheRead + u.cacheWrite, output: u.output, cost: u.cost.total };
    metrics.push(metric); calls.push(metric); await save();
    if (result.stopReason !== "stop" && result.stopReason !== "toolUse")
      throw new Error(`${kind}: ${result.errorMessage ?? result.stopReason}`);
    return result;
  };
  const classify = async (request: ClassifierRequest, metrics: CallMetric[], signal?: AbortSignal) => {
    const start = performance.now();
    const result = await runtime.classify(classifier, request, signal ? { signal } : {});
    if (!result.usage) throw new Error("Missing classifier usage");
    const u = result.usage;
    const metric = { kind: "classifier", ms: performance.now() - start, input: u.input + u.cacheRead + u.cacheWrite, output: u.output, cost: u.cost.total };
    metrics.push(metric); calls.push(metric); await save();
    return result;
  };
  return { calls, complete, classify, waited: () => waitedMs };
}
