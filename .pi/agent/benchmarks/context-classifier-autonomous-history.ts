import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { savedItems } from "../extensions/context-masking/evidence-archive";
import type { CompactionInput } from "../extensions/context-masking/classifier-compaction";
import { DEFAULT_SETTINGS, placeholder } from "../extensions/context-masking/policy";
import { readSavedArtifact } from "../extensions/context-masking/saved-artifact";
import {
  type RecallFixture,
  recallFixture,
  scoreRecall,
} from "./context-classifier-recall-fixtures";
import { assistant } from "./context-masking-recall-probe";

export function autonomousStages(seed: string): RecallFixture[] {
  const base = recallFixture(seed);
  const revised = recallFixture(`${seed}-revised`);
  const latest = recallFixture(`${seed}-latest`);
  const value = (f: RecallFixture, id: string) => {
    const p = f.probes.find((p) => p.id === id);
    if (!p?.expected) throw new Error(`Missing fixture value: ${id}`);
    return p.expected;
  };
  const update = (f: RecallFixture, values: Record<string, string>): RecallFixture => ({
    ...f,
    probes: f.probes.map((p) =>
      Object.hasOwn(values, p.id)
        ? {
            ...p,
            ...(p.expected === null ? {} : { rejected: p.expected }),
            expected: values[p.id] ?? null,
          }
        : p,
    ),
  });
  const first: RecallFixture = {
    ...base,
    probes: base.probes.map((p) =>
      p.id === "mirror"
        ? {
            ...p,
            question:
              "What is the latest verified mirror_checksum from the closed harbor mirror audit?",
          }
        : p,
    ),
  };
  const second = update(first, {
    schema: value(revised, "schema"),
    retention: value(revised, "retention"),
  });
  second.goal = `${base.goal} The approved schema and retention decisions have been revised. Use the latest approval.`;
  second.outputs = [
    `Ledger journal exporter revision 2 FINAL APPROVED schema_tag=${value(revised, "schema")}. Replaces the earlier schema approval. Earlier schema values are obsolete.`,
    `Ledger journal exporter revision 2 FINAL APPROVED retention_days=${value(revised, "retention")}. Replaces the earlier retention approval.`,
  ];
  const third = update(second, {
    restart: value(latest, "restart"),
    mirror: value(latest, "mirror"),
  });
  third.goal = `${base.goal} Restart behavior has a new approval. Previously revised schema and retention approvals remain current.`;
  third.outputs = [
    `Ledger journal exporter revision 3 FINAL APPROVED restart_marker=${value(latest, "restart")}. Replaces the earlier restart approval.`,
    `Harbor mirror audit revision 3: verified mirror_checksum=${value(latest, "mirror")}. Reopened audit is now closed. This supersedes the earlier checksum; unrelated to the ledger exporter.`,
  ];
  return [first, second, third].map((stage, phase) => ({
    ...stage,
    outputs: [
      ...stage.outputs,
      ...(phase === 0
        ? []
        : Array.from(
            { length: 10 },
            (_, i) =>
              `Closed service probe ${phase}-${i}: healthy. No changes to ledger exporter decisions; no pending work.`,
          )),
    ].map((text) => {
      const padding = "trace: background check successful\n".repeat(15);
      const output = `${padding}${text}\n${padding}`;
      if (output.length < DEFAULT_SETTINGS.minResultChars)
        throw new Error("Fixture is too short to qualify for masking");
      return output;
    }),
  }));
}

export interface AutonomousHistory {
  manager: SessionManager;
  artifactRoot: string;
  artifacts: Array<{ path: string; entryId: string; expected: string }>;
}

export function newHistory(dir: string): AutonomousHistory {
  return { manager: SessionManager.inMemory(dir), artifactRoot: join(dir, "saved"), artifacts: [] };
}

export async function appendStage(history: AutonomousHistory, stage: RecallFixture, phase: number) {
  const { manager, artifactRoot } = history;
  const session = join(artifactRoot, manager.getSessionId());
  await mkdir(session, { recursive: true, mode: 0o700 });
  manager.appendMessage({ role: "user", content: stage.goal, timestamp: phase });
  const items = [];
  for (const [i, text] of stage.outputs.entries()) {
    const id = `phase${phase}-call${i}`;
    manager.appendMessage(
      assistant([
        {
          type: "toolCall",
          id,
          name: "read",
          arguments: { path: `reports/phase-${phase}/scan-${i}.txt` },
        },
      ]),
    );
    const entryId = manager.appendMessage({
      role: "toolResult",
      toolCallId: id,
      toolName: "read",
      content: [{ type: "text", text }],
      isError: false,
      timestamp: phase * 100 + i,
    });
    const path = join(session, `${entryId}.txt`);
    await writeFile(path, text, { mode: 0o600 });
    items.push({ path, entryId, toolName: "read" });
    history.artifacts.push({ path, entryId, expected: text });
    manager.appendContextEdit(entryId, {
      content: [{ type: "text", text: placeholder({ entryId, toolName: "read", text }, path) }],
    });
  }
  manager.appendMessage(
    assistant([{ type: "text", text: "Investigation complete. Implementation pending." }]),
  );
  manager.appendCustomEntry("context-masking", { items });
}

export function compactionInput(history: AutonomousHistory, goal: string): CompactionInput {
  const messages = history.manager.buildSessionProjection().messages;
  const previous = messages.find((m) => m.role === "compactionSummary");
  return {
    sessionId: history.manager.getSessionId(),
    branch: history.manager.getBranch(),
    messages: messages.filter((m) => m.role !== "compactionSummary"),
    instructions: goal,
    ...(previous?.role === "compactionSummary" ? { previousSummary: previous.summary } : {}),
  };
}

export async function renderHistory(input: CompactionInput, root: string, hydrate: boolean) {
  const pieces = input.previousSummary ? [`[previous summary]\n${input.previousSummary}`] : [];
  const records = savedItems(input.branch);
  const sources = new Map(
    input.branch.flatMap((e) =>
      e.type === "message" && e.message.role === "toolResult"
        ? [[e.message.toolCallId, e.id] as const]
        : [],
    ),
  );
  for (const message of input.messages) {
    if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type === "text") pieces.push(`[assistant]\n${block.text}`);
        else if (block.type === "toolCall")
          pieces.push(`[call ${block.name}] ${JSON.stringify(block.arguments)}`);
      }
    } else if (message.role === "user" || message.role === "toolResult") {
      const content =
        typeof message.content === "string"
          ? message.content
          : message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
      pieces.push(`[${message.role}]\n${content}`);
      if (hydrate && message.role === "toolResult") {
        const entryId = sources.get(message.toolCallId);
        const record = entryId ? records.get(entryId) : undefined;
        if (!record) throw new Error("Missing saved result");
        const result = await readSavedArtifact(root, record, 12_000);
        if (result.partial) throw new Error("Fixture artifact exceeded hydration budget");
        pieces.push(`[saved output ${record.path}]\n${result.text}`);
      }
    } else throw new Error(`Unsupported fixture role: ${message.role}`);
  }
  return pieces.join("\n\n");
}

export async function artifactsPreserved(history: AutonomousHistory) {
  for (const item of history.artifacts) {
    const r = await readSavedArtifact(history.artifactRoot, item, 12_000);
    if (r.partial || r.text !== item.expected) return false;
  }
  return true;
}

export function scoreStagedRecall(stages: readonly RecallFixture[], phase: number, answer: string) {
  const stage = stages[phase];
  if (!stage) throw new Error("Missing scoring stage");
  const score = scoreRecall(stage.probes, answer);
  const checks = score.checks.map((check) => ({
    ...check,
    stale:
      score.valid &&
      !check.correct &&
      stages
        .slice(0, phase + 1)
        .some((stage) =>
          stage.probes.some(
            (p) =>
              p.id === check.id && (p.expected === check.actual || p.rejected === check.actual),
          ),
        ),
  }));
  return { ...score, checks, staleAnswers: checks.filter((check) => check.stale).length };
}
