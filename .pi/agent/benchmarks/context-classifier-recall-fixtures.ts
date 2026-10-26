import { createHash } from "node:crypto";

export interface RecallProbe {
  id: string;
  question: string;
  expected: string | null;
  category: "current" | "surprise" | "unknown";
  rejected?: string;
}
export interface RecallFixture {
  goal: string;
  outputs: string[];
  probes: RecallProbe[];
}

export function recallFixture(seed: string): RecallFixture {
  const token = (name: string) =>
    createHash("sha256").update(`${seed}:${name}`).digest("hex").slice(0, 10);
  const schema = `udtræk_æøå_${token("schema")}`;
  const rejected = `draft_${token("draft")}`;
  const output = `/srv/ledger/${token("output")}/events.jsonl`;
  const retention = String(11 + Number.parseInt(token("retention").slice(0, 2), 16));
  const restart = `cursor_${token("restart")}`;
  const checksum = `sha256:${token("mirror")}`;
  const build = `build_${token("build")}`;
  const outputs = [
    "Ledger journal exporter schema draft: schema_tag=" +
      rejected +
      ". Status: rejected, obsolete. This is not an approved schema.",
    "Ledger journal exporter final approved schema decision: schema_tag=" +
      schema +
      ". This replaces every draft.",
    "Ledger journal exporter approved output decision: output_path=" +
      output +
      ". This is the sole supported output destination.",
    "Ledger journal exporter approved retention decision: retention_days=" +
      retention +
      ". This number is authoritative.",
    "Ledger journal exporter approved restart decision: restart_marker=" +
      restart +
      ". Resume only from this marker.",
    "Closed harbor mirror audit: verified mirror_checksum=" +
      checksum +
      ". Mirror audit is complete and unrelated to the ledger journal exporter.",
    "Closed orchard build cache audit: accepted build_id=" +
      build +
      ". Build cache audit is complete and unrelated to the ledger journal exporter.",
    ...Array.from(
      { length: 9 },
      (_, i) =>
        "Closed service health probe " +
        i +
        ": successful. No journal schema, output, retention or restart decisions were made. No pending work.",
    ),
  ];
  // Opaque source names and seeded order prevent call metadata from revealing which bodies matter.
  outputs.sort((a, b) => token(a).localeCompare(token(b)));
  return {
    goal: "Continue implementing the ledger journal exporter. Preserve its final approved schema_tag, output_path, retention_days and restart_marker. Reject obsolete drafts. Other closed service audits are unrelated to this implementation.",
    outputs,
    probes: [
      {
        id: "schema",
        question: "What is the final approved schema_tag for the ledger journal exporter?",
        expected: schema,
        category: "current",
        rejected,
      },
      {
        id: "output",
        question: "What is the approved output_path for the ledger journal exporter?",
        expected: output,
        category: "current",
      },
      {
        id: "retention",
        question:
          "What is the approved retention_days number for the ledger journal exporter? Return the number as a string.",
        expected: retention,
        category: "current",
      },
      {
        id: "restart",
        question: "What is the approved restart_marker for the ledger journal exporter?",
        expected: restart,
        category: "current",
      },
      {
        id: "mirror",
        question: "What mirror_checksum was verified by the closed harbor mirror audit?",
        expected: checksum,
        category: "surprise",
      },
      {
        id: "build",
        question: "What build_id was accepted by the closed orchard build cache audit?",
        expected: build,
        category: "surprise",
      },
      {
        id: "unknown",
        question: "What signing_key_id was approved for the ledger journal exporter?",
        expected: null,
        category: "unknown",
      },
    ],
  };
}

export function scoreRecall(probes: readonly RecallProbe[], text: string) {
  let answers: Record<string, unknown> = {};
  let valid = true;
  try {
    const parsed: unknown = JSON.parse(
      text.trim().replace(/^\x60\x60\x60(?:json)?\s*([\s\S]*?)\s*\x60\x60\x60$/u, "$1"),
    );
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new Error("Expected an object");
    answers = Object.fromEntries(Object.entries(parsed));
    if (
      Object.keys(answers).length !== probes.length ||
      probes.some(
        (p) =>
          !Object.hasOwn(answers, p.id) ||
          (answers[p.id] !== null && typeof answers[p.id] !== "string"),
      )
    )
      throw new Error("Expected exact question IDs with string or null values");
  } catch {
    valid = false;
  }
  const checks = probes.map((p) => ({
    id: p.id,
    category: p.category,
    expected: p.expected,
    actual: answers[p.id] ?? null,
    correct: valid && answers[p.id] === p.expected,
    stale: valid && p.rejected !== undefined && answers[p.id] === p.rejected,
  }));
  const positives = checks.filter((c) => c.category !== "unknown");
  return {
    valid,
    positiveCorrect: positives.filter((c) => c.correct).length,
    positiveTotal: positives.length,
    currentCorrect: checks.filter((c) => c.category === "current" && c.correct).length,
    surpriseCorrect: checks.filter((c) => c.category === "surprise" && c.correct).length,
    unknownCorrect: checks.filter((c) => c.category === "unknown" && c.correct).length,
    staleAnswers: checks.filter((c) => c.stale).length,
    checks,
  };
}

export function factCoverage(probes: readonly RecallProbe[], text: string) {
  // Numeric answers can coincide with mask sizes; exact-answer scoring covers those separately.
  const positive = probes.filter((p) => p.expected !== null && !/^\d+$/u.test(p.expected));
  return {
    present: positive.filter((p) => p.expected !== null && text.includes(p.expected)).length,
    total: positive.length,
  };
}
