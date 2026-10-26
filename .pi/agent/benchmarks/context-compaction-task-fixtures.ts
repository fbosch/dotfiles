import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Script } from "node:vm";

export interface HistoryUnit {
  kind: "user" | "assistant" | "tool";
  text: string;
  source?: string;
}
interface Check {
  name: string;
  input: unknown;
  expected: unknown;
  critical?: boolean;
}
export interface CodingCase {
  name: string;
  goal: string;
  request: string;
  exportName: string;
  history: HistoryUnit[];
  checks: Check[];
  reference: string;
}
const padding = () =>
  Array.from({ length: 100 }, (_, i) => `metric ${i}: successful background check`).join("\n");
const report = (topic: string, decision: string) =>
  `${padding()}\n${topic}: ${decision}\n${padding()}`;
const user = (text: string): HistoryUnit => ({ kind: "user", text });
const assistant = (text: string): HistoryUnit => ({ kind: "assistant", text });
const tool = (source: string, text: string): HistoryUnit => ({ kind: "tool", source, text });

export function codingCases(seed = "pilot-1"): CodingCase[] {
  const token = (name: string) =>
    createHash("sha256").update(`${seed}:${name}`).digest("hex").slice(0, 8);
  const routing = `route-${token("routing")}`;
  const checksum = `sum-${token("journal")}`;
  return [
    {
      name: "routing",
      goal: "Implement normalizeEvents(events), using the approved migration routing profile and review constraints.",
      request:
        "Continue implementation of normalizeEvents(events) using the approved migration routing profile and the latest review constraints. Return only a JavaScript module with that named export.",
      exportName: "normalizeEvents",
      history: [
        user(
          "Investigate normalization before coding. Each input record has id, label, and enabled. For every surviving record, route must be the same single constant value printed by the approved report; the report is not an id-to-route mapping. Preserve input order. Never mutate input records. Return a new array of new objects containing exactly id, label, route. Exclude records with enabled !== true. Preserve labels exactly, including Danish æ, ø, å. Do not add dependencies.",
        ),
        user("Initial proposal: lowercase every id and use the provisional routing profile."),
        tool(
          "reports/migration-routing-provisional.txt",
          report(
            "Provisional migration routing profile",
            "route-obsolete; this proposal is superseded by the approved report.",
          ),
        ),
        assistant("Storage and connectivity checks are healthy. No code has been written."),
        user(
          "Correction: preserve id case exactly; lowercasing is rejected. The approved migration routing report is authoritative for the route value.",
        ),
        tool(
          "reports/migration-routing-approved.txt",
          report("Approved migration routing profile", routing),
        ),
        user(
          "Do not copy secret or any other extra properties into output. Keep the named export normalizeEvents.",
        ),
        assistant(
          "Investigation complete. The next step is implementation under the latest review.",
        ),
      ],
      checks: [
        {
          name: "approved route and exact Danish text",
          input: [{ id: "AbC", label: "Blåbær på øen", enabled: true, secret: "private" }],
          expected: [{ id: "AbC", label: "Blåbær på øen", route: routing }],
          critical: true,
        },
        {
          name: "strict enabled filter",
          input: [
            { id: "a", label: "a", enabled: 1 },
            { id: "b", label: "b", enabled: false },
          ],
          expected: [],
        },
        {
          name: "order and no leaked fields",
          input: [
            { id: "Z", label: "å", enabled: true, extra: 4 },
            { id: "A", label: "æ", enabled: true },
          ],
          expected: [
            { id: "Z", label: "å", route: routing },
            { id: "A", label: "æ", route: routing },
          ],
          critical: true,
        },
        { name: "empty input", input: [], expected: [] },
      ],
      reference: `export function normalizeEvents(events) { return events.filter(e => e.enabled === true).map(e => ({ id: e.id, label: e.label, route: "${routing}" })); }`,
    },
    {
      name: "retry",
      goal: "Implement retryDelays(statuses) using the approved retry policy incident budget and review constraints.",
      request:
        "Continue implementation of retryDelays(statuses) using the approved retry policy incident budget and the latest review constraints. Return only a JavaScript module with that named export.",
      exportName: "retryDelays",
      history: [
        user(
          "Investigate retry scheduling before coding. statuses is an array of integer HTTP status codes, not objects. Omit every non-retryable status from the result entirely. Return an array of objects with exactly status and delay. Preserve input order and do not mutate inputs. Only 429 and 503 are retryable. Never retry 401 or 403.",
        ),
        user(
          "Initial proposal: base delay 5 and cap 80. Count every input record when increasing the exponent.",
        ),
        tool(
          "reports/retry-policy-provisional.txt",
          report(
            "Provisional retry policy incident budget",
            "base=5; cap=80; superseded by approved report.",
          ),
        ),
        assistant("Routine capacity checks completed successfully. No implementation yet."),
        user(
          "Correction: exponent increases only for retryable records. First retry gets base, second base*2, then base*4, capped. The approved retry policy incident budget report supersedes the provisional values.",
        ),
        tool(
          "reports/retry-policy-approved.txt",
          report("Approved retry policy incident budget", "base=7; cap=37"),
        ),
        user(
          "Do not return any fields except status and delay. Do not add dependencies. Keep named export retryDelays.",
        ),
        assistant(
          "The next step is implementation using the approved policy, not the initial proposal.",
        ),
      ],
      checks: [
        {
          name: "approved base and cap",
          input: [503, 503, 503, 503, 503],
          expected: [
            { status: 503, delay: 7 },
            { status: 503, delay: 14 },
            { status: 503, delay: 28 },
            { status: 503, delay: 37 },
            { status: 503, delay: 37 },
          ],
          critical: true,
        },
        {
          name: "auth errors never retry and do not advance exponent",
          input: [401, 503, 403, 429],
          expected: [
            { status: 503, delay: 7 },
            { status: 429, delay: 14 },
          ],
          critical: true,
        },
        {
          name: "other statuses are ignored",
          input: [200, 500, 404, 429],
          expected: [{ status: 429, delay: 7 }],
        },
        { name: "empty input", input: [], expected: [] },
      ],
      reference:
        "export function retryDelays(statuses) { let n=0; return statuses.filter(s => s===429 || s===503).map(status => ({status, delay: Math.min(37, 7*2**n++)})); }",
    },
    {
      name: "journal",
      goal: "Implement serializeRecord(record) using the approved journal serialization checksum and latest review constraints.",
      request:
        "Continue implementation of serializeRecord(record) using the approved journal serialization checksum and the latest review constraints. Return only a JavaScript module with that named export.",
      exportName: "serializeRecord",
      history: [
        user(
          "Investigate journal serialization before coding. The input contains id and an optional label; checksum is an output-only constant copied from the approved report, never read from the input record. Never mutate the input. Preserve id and label values exactly, including Danish letters. Omit secret and every unrelated property. Do not add dependencies.",
        ),
        user("Initial proposal: return id|label|checksum and trim labels."),
        tool(
          "reports/journal-provisional.txt",
          report(
            "Provisional journal serialization checksum",
            "sum-obsolete; superseded by approved report.",
          ),
        ),
        assistant("The unrelated audit is closed; there is no work pending on it."),
        user(
          "Correction: the result must be a JSON string, not delimiter-separated text. Do not trim labels. JSON key order must be id, label, checksum. The approved journal serialization checksum report is authoritative.",
        ),
        tool(
          "reports/journal-approved.txt",
          report("Approved journal serialization checksum", checksum),
        ),
        user(
          "Missing label becomes an empty string; do not treat an explicit empty string as missing. Keep named export serializeRecord.",
        ),
        assistant(
          "Implementation remains pending; the corrected JSON contract is the current decision.",
        ),
      ],
      checks: [
        {
          name: "current JSON contract and approved checksum",
          input: { id: "Z", label: "  ø og å  ", secret: "private" },
          expected: JSON.stringify({ id: "Z", label: "  ø og å  ", checksum }),
          critical: true,
        },
        {
          name: "missing label",
          input: { id: "x", extra: 7 },
          expected: JSON.stringify({ id: "x", label: "", checksum }),
        },
        {
          name: "explicit empty label",
          input: { id: "y", label: "" },
          expected: JSON.stringify({ id: "y", label: "", checksum }),
        },
        {
          name: "escaped characters and Danish preserved",
          input: { id: "AbC", label: 'æ"ø\\å' },
          expected: JSON.stringify({ id: "AbC", label: 'æ"ø\\å', checksum }),
          critical: true,
        },
      ],
      reference: `export function serializeRecord(record) { return JSON.stringify({id: record.id, label: record.label === undefined ? "" : record.label, checksum: "${checksum}"}); }`,
    },
  ];
}

export function scoreCode(task: CodingCase, output: string) {
  const source = output
    .trim()
    .replace(/^\x60\x60\x60(?:javascript|js)?\s*/u, "")
    .replace(/\s*\x60\x60\x60$/u, "");
  // This VM is a bounded functional harness for non-adversarial synthetic completions,
  // not a security boundary for arbitrary or attacker-supplied code.
  const checks = task.checks.map((check) => {
    try {
      if (
        !source.includes(`export function ${task.exportName}`) &&
        !source.includes(`export const ${task.exportName}`)
      )
        throw new Error("Missing named export");
      const script = new Script(`"use strict";\n${source.replace(/\bexport\s+/gu, "")}
const input = ${JSON.stringify(check.input)};
const before = JSON.stringify(input);
function freeze(value) { if (value && typeof value === "object") { Object.freeze(value); Object.values(value).forEach(freeze); } }
freeze(input);
const actual = ${task.exportName}(input);
const reusesInput = actual === input || (Array.isArray(actual) && Array.isArray(input) && actual.some(item => item && typeof item === "object" && input.includes(item)));
JSON.stringify({ actual, unchanged: before === JSON.stringify(input), reusesInput });`);
      const raw: unknown = script.runInNewContext({}, { timeout: 250 });
      if (typeof raw !== "string") throw new Error("Non-serializable result");
      const parsed: { actual: unknown; unchanged: boolean; reusesInput: boolean } = JSON.parse(raw);
      const correct =
        parsed.unchanged && !parsed.reusesInput && isDeepStrictEqual(parsed.actual, check.expected);
      return {
        name: check.name,
        critical: check.critical ?? false,
        passed: correct,
        error: correct ? "" : "Wrong output or input mutation",
      };
    } catch (error: unknown) {
      return {
        name: check.name,
        critical: check.critical ?? false,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  return {
    passed: checks.filter((c) => c.passed).length,
    total: checks.length,
    taskSuccess: checks.every((c) => c.passed),
    criticalViolations: checks.filter((c) => c.critical && !c.passed).length,
    checks,
  };
}
