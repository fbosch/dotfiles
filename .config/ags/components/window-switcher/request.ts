import { isMatching, P } from "ts-pattern";

const supportedModifiers = new Set([
  "ALT",
  "SUPER",
  "CTRL",
  "CONTROL",
  "SHIFT",
]);
const supportedModifierPattern = P.when(
  (value): value is string =>
    typeof value === "string" && supportedModifiers.has(value.toUpperCase()),
);

const windowSwitcherRequestPattern = P.union(
  { action: "show" },
  { action: "next", triggerModifier: P.optional(supportedModifierPattern) },
  { action: "prev", triggerModifier: P.optional(supportedModifierPattern) },
  { action: "commit" },
  { action: "hide" },
  { action: "set-mode", mode: P.optional(P.string) },
  { action: "toggle-mode" },
  { action: "set-sort-mode", mode: P.optional(P.string) },
  { action: "get-sort-mode" },
  { action: "get-mode" },
  { action: "get-visibility" },
);

export type WindowSwitcherRequest = P.infer<
  typeof windowSwitcherRequestPattern
>;

export function parseWindowSwitcherRequest(
  value: unknown,
): WindowSwitcherRequest | null {
  return isMatching(windowSwitcherRequestPattern, value) ? value : null;
}
