export type Engine = "delta" | "archimedes";
export type Layout = "inline" | "side-by-side";
export type Phase = "first-render" | "warm-unique" | "warm-repeat";
export const CASES = { small: 12, medium: 60, large: 1600 } as const;
export type CaseName = keyof typeof CASES;

export function fixture(name: CaseName, variant: number) {
  const lines = CASES[name];
  const tag = String(variant).padStart(5, "0");
  const source = (side: string) =>
    Array.from(
      { length: lines },
      (_, index) =>
        `const item${String(index).padStart(4, "0")} = "${side}_${tag}_${String(index).padStart(4, "0")}_æøå";`,
    ).join("\n") + "\n";
  return { oldContent: source("old"), newContent: source("new") };
}

export interface Sample {
  engine: Engine;
  caseName: CaseName;
  layout: Layout;
  trial: number;
  phase: Phase;
  iteration: number;
  durationMs: number;
  outputBytes: number;
  outputHash: string;
  archimedesHighlightEligible: boolean;
}

export function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing benchmark value");
  return value;
}

export function distribution(values: number[]) {
  if (!values.length || values.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new Error("Expected nonempty, finite, nonnegative timings");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2
      ? required(sorted[middle])
      : (required(sorted[middle - 1]) + required(sorted[middle])) / 2;
  return {
    count: sorted.length,
    medianMs: median,
    p95Ms: required(sorted[Math.ceil(sorted.length * 0.95) - 1]),
    minMs: required(sorted[0]),
    maxMs: required(sorted.at(-1)),
  };
}

export function summarize(samples: Sample[]) {
  const keys = [...new Set(samples.map((s) => `${s.caseName}/${s.layout}/${s.phase}/${s.engine}`))];
  return keys.map((key) => {
    const group = samples.filter((s) => `${s.caseName}/${s.layout}/${s.phase}/${s.engine}` === key);
    return {
      key,
      ...distribution(group.map((s) => s.durationMs)),
      archimedesHighlightEligible: required(group[0]).archimedesHighlightEligible,
    };
  });
}

export function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`Expected a positive integer, got ${value}`);
  }
  return Number(value);
}

export function verifyOutput(output: string, oldContent: string, newContent: string): void {
  // Strip SGR only; all fixtures fit without wrapping at the fixed benchmark widths.
  const sgr = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  const plain = output.replace(sgr, "");
  for (const line of [...oldContent.trimEnd().split("\n"), ...newContent.trimEnd().split("\n")]) {
    if (!plain.includes(line)) throw new Error(`Rendered output lost source line: ${line}`);
  }
  if (!new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`).test(output)) {
    throw new Error("Renderer emitted no ANSI styles");
  }
}
