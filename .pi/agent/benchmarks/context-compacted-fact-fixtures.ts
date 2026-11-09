import { createHash } from "node:crypto";
import { type RecallProbe, scoreRecall } from "./context-classifier-recall-fixtures";
import { largeRecallCorpus } from "./context-recall-large-corpus";
import type { RecallArchive } from "./context-recall-offline";

export type CorpusScenario = "receipt" | "diverse";
export type FactType = "receipt" | "identifier" | "number" | "path" | "date" | "danish";
export type QuestionWording = "direct" | "paraphrased";
export interface CompactedFact {
  index: number;
  entity: string;
  value: string;
  evidence: string;
  question: string;
  factType: FactType;
  wording: QuestionWording;
  previous?: string;
}
export interface CompactedCorpus {
  facts: CompactedFact[];
  archives: RecallArchive[];
}
export interface CompactedProbe extends RecallProbe {
  entity?: string;
  evidence?: string;
  factType?: FactType;
  wording?: QuestionWording;
}

const hash = (seed: string, name: string) =>
  createHash("sha256").update(`${seed}:${name}`).digest("hex");
const factTypes = ["identifier", "number", "path", "date", "danish"] as const;
const entityName = (index: number) =>
  `svc${[Math.floor(index / 676), Math.floor(index / 26) % 26, index % 26]
    .map((digit) => String.fromCharCode(97 + digit))
    .join("")}q`;

const definitions = {
  identifier: [
    {
      field: "approval_code",
      paraphrase: "Which authorization reference should the team use for service",
    },
    {
      field: "restart_token",
      paraphrase: "Which exact marker should resume processing for service",
    },
  ],
  number: [
    {
      field: "retention_days",
      paraphrase: "For how many days should archived records be kept for service",
    },
    {
      field: "retry_ceiling",
      paraphrase: "How many retries are allowed before giving up for service",
    },
  ],
  path: [
    { field: "output_path", paraphrase: "Where should exported records be written by service" },
    { field: "backup_path", paraphrase: "Where should recovery copies be stored for service" },
  ],
  date: [
    { field: "review_date", paraphrase: "When is the next review due for service" },
    { field: "expiry_date", paraphrase: "When does the current approval expire for service" },
  ],
  danish: [
    { field: "mødested", paraphrase: "Hvor skal medarbejderne mødes for tjenesten" },
    { field: "operatørbesked", paraphrase: "Hvilken besked skal operatøren følge for tjenesten" },
  ],
} as const;

function diverseCorpus(seed: string): CompactedCorpus {
  const facts = Array.from({ length: 1_000 }, (_, index): CompactedFact => {
    const factType = factTypes[index % factTypes.length];
    if (!factType) throw new Error("Missing fact type");
    const variant = Number.parseInt(hash(seed, `field:${index}`).slice(0, 4), 16) % 2;
    const definition = definitions[factType][variant];
    if (!definition) throw new Error("Missing field definition");
    const entity = entityName(index);
    const wording = Math.floor(index / factTypes.length) % 2 === 0 ? "direct" : "paraphrased";
    const valueFor = (revision: string): string => {
      const token = hash(seed, `${index}:${revision}`);
      const number = Number.parseInt(token.slice(0, 8), 16);
      switch (factType) {
        case "identifier":
          return `${variant === 0 ? "approval" : "cursor"}-${token.slice(0, 16)}`;
        case "number":
          return String(variant === 0 ? 3 + (number % 363) : 1 + (number % 12));
        case "path":
          return `/srv/${variant === 0 ? "exports" : "backups"}/æble-${token.slice(0, 12)}/records.jsonl`;
        case "date":
          return new Date(Date.UTC(2031, 0, 1) + (number % 3_650) * 86_400_000)
            .toISOString()
            .slice(0, 10);
        case "danish": {
          const colors = ["blå", "grøn", "rød", "grå"];
          const places = ["døren ved åen", "porten mod øst", "hallen på øen", "trappen ved søen"];
          const color = colors[number % colors.length];
          const place = places[Math.floor(number / colors.length) % places.length];
          if (!color || !place) throw new Error("Missing Danish phrase");
          return variant === 0
            ? `${color} markering ved ${place}`
            : `følg den ${color} markering ved ${place}`;
        }
      }
    };
    const value = valueFor("current");
    const revised = Math.floor(index / 10) % 5 === 0;
    let previous: string | undefined;
    if (revised) {
      for (let attempt = 0; attempt < 32; attempt++) {
        const candidate = valueFor(`previous-${attempt}`);
        if (candidate !== value) {
          previous = candidate;
          break;
        }
      }
      if (previous === undefined) throw new Error("Revision did not change the fact");
    }
    const evidence =
      factType === "danish"
        ? `Tjeneste ${entity} har godkendt ${definition.field}: ${value}.`
        : `Service ${entity} approved ${definition.field}: ${value}.`;
    const question =
      wording === "paraphrased"
        ? `${definition.paraphrase} ${entity}?`
        : factType === "danish"
          ? `Hvad er det senest godkendte ${definition.field} for tjenesten ${entity}?`
          : `What is the latest approved ${definition.field} for service ${entity}?`;
    return {
      index,
      entity,
      value,
      evidence,
      question,
      factType,
      wording,
      ...(previous === undefined ? {} : { previous }),
    };
  });
  const archives: RecallArchive[] = [];
  for (let start = 0; start < facts.length; start += 10) {
    const group = facts.slice(start, start + 10);
    const path = `reports/scan-${hash(seed, `source:${start}`).slice(0, 12)}.txt`;
    const revised = group.some((fact) => fact.previous !== undefined);
    if (revised) {
      archives.push({
        tool: "read",
        args: { path },
        text:
          "Service audit revision 1.\n" +
          group
            .map((fact) =>
              fact.previous === undefined
                ? fact.evidence
                : fact.evidence.replace(fact.value, fact.previous),
            )
            .join("\n"),
      });
    }
    archives.push({
      tool: "read",
      args: { path },
      text:
        (revised
          ? "Service audit revision 2, superseding revision 1.\n"
          : "Service audit snapshot.\n") + group.map((fact) => fact.evidence).join("\n"),
    });
  }
  return { facts, archives };
}

export function compactedFactCorpus(seed: string, scenario: CorpusScenario): CompactedCorpus {
  if (scenario === "diverse") return diverseCorpus(seed);
  const corpus = largeRecallCorpus(seed);
  return {
    archives: corpus.archives,
    facts: corpus.facts.map((fact, index) => {
      const previous = corpus.probes.find((probe) => probe.expected === fact.value)?.stale;
      return {
        index,
        entity: fact.entity,
        value: fact.value,
        evidence: `Service ${fact.entity} approved receipt: ${fact.value}.`,
        question: `What was the latest approved receipt for service ${fact.entity}?`,
        factType: "receipt",
        wording: "direct",
        ...(previous === undefined ? {} : { previous }),
      };
    }),
  };
}

export function messageEvidenceText(messages: readonly unknown[]): string {
  return messages
    .flatMap((message) => {
      if (typeof message !== "object" || message === null) return [];
      if ("role" in message && message.role === "assistant") return [];
      if ("summary" in message && typeof message.summary === "string") return [message.summary];
      if (!("content" in message)) return [];
      if (typeof message.content === "string") return [message.content];
      if (!Array.isArray(message.content)) return [];
      return message.content.flatMap((block: unknown) =>
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string"
          ? [block.text]
          : [],
      );
    })
    .join("\n");
}

export function evidencePresent(
  text: string,
  fact: { entity: string; value: string; evidence?: string },
): boolean {
  if (fact.evidence && text.includes(fact.evidence)) return true;
  const escaped = fact.value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const value = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "u");
  // Fixture statements put the value after the entity. Requiring that order excludes
  // citation line numbers; matching scalars elsewhere do not establish this fact.
  return text
    .replaceAll("\\n", "\n")
    .split("\n")
    .some((line) => {
      const at = line.indexOf(fact.entity);
      return at >= 0 && value.test(line.slice(at + fact.entity.length));
    });
}

export function probeEvidencePresent(text: string, probe: CompactedProbe): boolean {
  return (
    probe.expected !== null &&
    probe.entity !== undefined &&
    evidencePresent(text, {
      entity: probe.entity,
      value: probe.expected,
      ...(probe.evidence === undefined ? {} : { evidence: probe.evidence }),
    })
  );
}

export function selectCompactedQuestions(
  corpus: CompactedCorpus,
  visible: string,
  seed: string,
  count: number,
  scenario: CorpusScenario,
) {
  const eligible = corpus.facts.filter((fact) => !evidencePresent(visible, fact));
  if (eligible.length < Math.max(count, corpus.facts.length * 0.9))
    throw new Error("Too few facts left active context to measure compacted-fact retrieval");
  const ranked = [...eligible].sort((a, b) =>
    hash(seed, `held-out:${a.entity}`).localeCompare(hash(seed, `held-out:${b.entity}`)),
  );
  const balanced = (facts: CompactedFact[], amount: number, rotation = 0) => {
    const buckets = [0, 1, 2].map((age) =>
      facts.filter(
        (fact) => Math.min(2, Math.floor((fact.index * 3) / corpus.facts.length)) === age,
      ),
    );
    const picked: CompactedFact[] = [];
    while (picked.length < amount) {
      let progress = false;
      for (let i = 0; i < 3 && picked.length < amount; i++) {
        const next = buckets[(i + rotation) % 3]?.shift();
        if (next) {
          picked.push(next);
          progress = true;
        }
      }
      if (!progress) throw new Error("Insufficient hidden facts for a sampling stratum");
    }
    return picked;
  };
  let selected: CompactedFact[];
  if (scenario === "receipt") {
    selected = ranked.filter((fact) => fact.previous !== undefined).slice(0, count);
    const seen = new Set(selected.map((fact) => fact.index));
    selected.push(
      ...balanced(
        ranked.filter((fact) => !seen.has(fact.index)),
        count - selected.length,
      ),
    );
  } else {
    const strata = factTypes.flatMap((kind) =>
      ["direct", "paraphrased"].map((wording) =>
        ranked.filter((fact) => fact.factType === kind && fact.wording === wording),
      ),
    );
    const samples = strata.map((stratum, index) => {
      const quota = Math.floor(count / strata.length) + Number(index < count % strata.length);
      const revisions = quota < 2 ? 0 : Math.max(1, Math.round(quota * 0.2));
      return [
        ...balanced(
          stratum.filter((fact) => fact.previous !== undefined),
          revisions,
          index % 3,
        ),
        ...balanced(
          stratum.filter((fact) => fact.previous === undefined),
          quota - revisions,
          index % 3,
        ),
      ];
    });
    selected = [];
    while (selected.length < count) {
      for (const sample of samples) {
        const next = sample.shift();
        if (next) selected.push(next);
      }
    }
  }
  const probes: CompactedProbe[] = selected.map((fact) => ({
    id: `fact_${fact.index}`,
    question: fact.question,
    expected: fact.value,
    category: "surprise",
    source: "read",
    entity: fact.entity,
    evidence: fact.evidence,
    factType: fact.factType,
    wording: fact.wording,
    ...(fact.previous === undefined ? {} : { rejected: fact.previous }),
  }));
  return { eligible: eligible.length, probes };
}

export function scoreCompactedProbes(probes: readonly CompactedProbe[], text: string) {
  const result = scoreRecall(probes, text);
  return {
    ...result,
    checks: result.checks.map((check, index) => ({
      ...check,
      factType: probes[index]?.factType ?? "unknown",
      wording: probes[index]?.wording ?? "unknown",
      revised: probes[index]?.rejected !== undefined,
    })),
  };
}

export function summarizeFactDimensions(checks: ReturnType<typeof scoreCompactedProbes>["checks"]) {
  const known = checks.filter((check) => check.expected !== null);
  const group = (key: (check: (typeof known)[number]) => string) => {
    const names = [...new Set(known.map(key))].sort();
    return names.map((name) => {
      const rows = known.filter((check) => key(check) === name);
      return {
        group: name,
        correct: rows.filter((check) => check.correct).length,
        total: rows.length,
        stale: rows.filter((check) => check.stale).length,
        unanswered: rows.filter((check) => check.actual === null).length,
      };
    });
  };
  return {
    byFactType: group((check) => check.factType),
    byWording: group((check) => check.wording),
    byTypeAndWording: group((check) => `${check.factType}/${check.wording}`),
    byRevision: group((check) => (check.revised ? "revised" : "unchanged")),
  };
}
