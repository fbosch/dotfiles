export function covered(value: boolean): string {
  if (value) return "covered";
  return "fallback";
}

export const uncovered = (): string => "uncovered";

export class Example {
  method(): string {
    return "method";
  }
}

// This arrow is declared during module initialization but never called.
export const uncalledExpression = (): string => "uncalled";

export function entryLineDeterminesCoverage(): number {
  const value = 1;
  return value;
}
