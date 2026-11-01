import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type Row, summarize } from "./evaluate";
import { deliveryVerified } from "./delivery";
import { heldoutScenarios } from "./heldout";
import { grade, scenarios, type Trace, World } from "./fixtures";

export type EvidenceDocument = Record<string, unknown> | unknown[];

export function parseEvidence(text: string, source: string): EvidenceDocument {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object") throw new Error("Expected evidence object or array");
    return Array.isArray(value) ? value : value as Record<string, unknown>;
  } catch (cause) {
    throw new Error(`Invalid JSON in evaluation evidence: ${source}`, { cause });
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected object");
  return value as Record<string, unknown>;
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error("Expected nonnegative number");
  return value;
}

export function replayAttempt(input: unknown): Row {
  const data = object(input);
  const original = object(data.row);
  const scenario = [...scenarios(), ...heldoutScenarios()].find((s) => s.id === original.id);
  const arm = original.arm;
  const repeat = number(original.repeat);
  if (
    !scenario ||
    (arm !== "baseline" && arm !== "candidate") ||
    !Number.isInteger(repeat) ||
    repeat > 2
  )
    throw new Error("Unknown attempt identity");
  const world = new World(scenario);
  if (!Array.isArray(data.trace)) throw new Error("Missing trace");
  for (const item of data.trace) {
    const entry = object(item);
    const result = entry.result;
    if (
      typeof entry.tool !== "string" ||
      typeof entry.target !== "string" ||
      typeof entry.avoidable !== "boolean" ||
      (result !== "ok" && result !== "denied" && result !== "missing" && result !== "blocked")
    )
      throw new Error("Invalid trace");
    const trace: Trace = {
      tool: entry.tool,
      target: entry.target,
      avoidable: entry.avoidable,
      result,
    };
    world.trace.push(trace);
  }
  for (const [path, content] of Object.entries(object(data.files))) {
    if (typeof content !== "string") throw new Error("Invalid virtual file");
    world.files.set(path, content);
  }
  if (typeof data.reply !== "string") throw new Error("Missing reply");
  if (original.infraError !== null && typeof original.infraError !== "string")
    throw new Error("Invalid infrastructure status");
  return {
    id: scenario.id,
    arm,
    repeat,
    infraError: original.infraError,
    deliveryValid: deliveryVerified(data.delivery, data.guidance),
    providerRequests: Array.isArray(data.delivery) ? data.delivery.length : 0,
    score: grade(world, data.reply),
    elapsedMs: number(original.elapsedMs),
    calls: number(original.calls),
    tokens: number(original.tokens),
    estimatedCostUSD: number(original.estimatedCostUSD),
  };
}

export async function replay(directory: string) {
  const root = resolve(directory);
  const originalText = await readFile(join(root, "results.json"), "utf8");
  const original = parseEvidence(originalText, join(root, "results.json"));
  if (!Array.isArray(original)) throw new Error("Invalid results");
  const hashes: Record<string, string> = {
    "results.json": createHash("sha256").update(originalText).digest("hex"),
  };
  const rows: Row[] = [];
  for (const input of original) {
    const row = object(input);
    if (
      ![...scenarios(), ...heldoutScenarios()].some((s) => s.id === row.id) ||
      (row.arm !== "baseline" && row.arm !== "candidate") ||
      !Number.isInteger(row.repeat) ||
      typeof row.repeat !== "number" ||
      row.repeat < 0 ||
      row.repeat > 2
    )
      throw new Error("Invalid attempt identity");
    const name = `${row.id}-${row.repeat}-${row.arm}.json`;
    const raw = await readFile(join(root, name), "utf8");
    hashes[name] = createHash("sha256").update(raw).digest("hex");
    const rescored = replayAttempt(parseEvidence(raw, join(root, name)));
    if (rescored.id !== row.id || rescored.arm !== row.arm || rescored.repeat !== row.repeat)
      throw new Error("Mismatched artifact");
    rows.push(rescored);
  }
  const scorerHash = createHash("sha256")
    .update(await readFile(new URL("./fixtures.ts", import.meta.url)))
    .digest("hex");
  const summary = summarize(rows);
  const output = join(root, `rescored-${Date.now()}.json`);
  await writeFile(output, JSON.stringify({ scorerHash, hashes, rows, summary }, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  console.log(JSON.stringify({ output, ...summary }));
}

if (import.meta.main) {
  const directory = process.argv[2];
  if (!directory) throw new Error("Provide a saved run directory; replay makes no model requests");
  await replay(directory);
}
