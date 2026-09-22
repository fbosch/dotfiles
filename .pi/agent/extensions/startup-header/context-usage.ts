export interface StartupContextUsage {
  readonly tokens: number | null;
  readonly contextWindow: number;
  readonly percent: number | null;
}

export interface ContextUsageSource {
  readonly getContextUsage?: (() => unknown) | undefined;
  readonly model?: { readonly contextWindow?: unknown } | undefined;
}

export function readContextUsage(value: unknown): StartupContextUsage | undefined {
  if (!isRecord(value)) return undefined;
  const { tokens, contextWindow, percent } = value;
  if (!isTokenValue(tokens) || !isPositiveInteger(contextWindow) || !isPercent(percent)) {
    return undefined;
  }
  return Object.freeze({ tokens, contextWindow, percent });
}

export function readContextUsageFromContext(
  context: ContextUsageSource,
): StartupContextUsage | undefined {
  let usage: StartupContextUsage | undefined;
  try {
    usage =
      typeof context.getContextUsage === "function"
        ? readContextUsage(context.getContextUsage())
        : undefined;
  } catch {
    usage = undefined;
  }
  if (usage !== undefined) return usage;

  const contextWindow = context.model?.contextWindow;
  return isPositiveInteger(contextWindow)
    ? Object.freeze({ tokens: null, contextWindow, percent: null })
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTokenValue(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isPercent(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}
