import { createHash } from "node:crypto";
import type { RecallArchive, RecallProbe } from "./context-recall-offline";

const FACT_COUNT = 1_000;
const FACTS_PER_ARCHIVE = 10;
const TARGETS = [5, 115, 335, 495, 505, 755, 905, 995];
const REVISED = new Set([505, 905]);

// Alphabetic keys avoid incidental numeric-token overlap between unrelated services.
function key(index: number): string {
  return [Math.floor(index / 676), Math.floor(index / 26) % 26, index % 26]
    .map((digit) => String.fromCharCode(97 + digit))
    .join("");
}

export function largeRecallCorpus(seed = "large-recall-1") {
  const value = (index: number, revision: string) =>
    `receipt-æøå-${createHash("sha256").update(`${seed}:${index}:${revision}`).digest("hex").slice(0, 16)}`;
  const facts = Array.from({ length: FACT_COUNT }, (_, index) => ({
    entity: `ledger${key(index)}q`,
    value: value(index, "current"),
    source: `reports/bundle${key(Math.floor(index / FACTS_PER_ARCHIVE))}q.txt`,
    line: (index % FACTS_PER_ARCHIVE) + 1,
  }));
  const sentence = (entity: string, receipt: string) =>
    `Service ${entity} approved receipt: ${receipt}.`;
  const archives: RecallArchive[] = [];
  for (let start = 0; start < FACT_COUNT; start += FACTS_PER_ARCHIVE) {
    const group = facts.slice(start, start + FACTS_PER_ARCHIVE);
    const first = group[0];
    if (!first) throw new Error("Empty fact archive");
    // Keep both snapshots in the scan: identical wording makes recency break the ranking tie.
    if (group.some((_, offset) => REVISED.has(start + offset))) {
      archives.push({
        tool: "read",
        args: { path: first.source },
        text: group
          .map((fact, offset) =>
            sentence(
              fact.entity,
              REVISED.has(start + offset) ? value(start + offset, "obsolete") : fact.value,
            ),
          )
          .join("\n"),
      });
    }
    archives.push({
      tool: "read",
      args: { path: first.source },
      text: group.map((fact) => sentence(fact.entity, fact.value)).join("\n"),
    });
  }
  const targets = TARGETS.map((index) => {
    const fact = facts[index];
    if (!fact) throw new Error("Missing target fact");
    return { ...fact, index };
  });
  const probes: RecallProbe[] = targets.map((fact) => ({
    id: `fact-${fact.index}`,
    category: REVISED.has(fact.index) ? "superseded" : "identifier",
    question: `What is the approved receipt for service ${fact.entity}?`,
    expected: fact.value,
    ...(REVISED.has(fact.index) ? { stale: value(fact.index, "obsolete") } : {}),
    prefetch: true,
  }));
  probes.push(
    {
      id: "unknown-field",
      category: "near-miss",
      question: `What is the approved signing key for service ${targets[7]?.entity}?`,
      expected: null,
      prefetch: true,
    },
    {
      id: "unrelated-question",
      category: "distractor",
      question: "Who won the Copenhagen chess tournament?",
      expected: null,
      prefetch: true,
    },
  );
  return { facts, archives, targets, probes };
}
