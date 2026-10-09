import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  appendDelimiterAndCorrect,
  isTypoDelimiter,
  parseTypoRules,
  typoRuleLengths,
} from "./typo-engine";

export interface TypoCorrectionRules {
  rules: ReadonlyMap<string, string>;
  lengths: ReadonlySet<number>;
}

let cachedRules: TypoCorrectionRules | undefined;

export function loadTypoCorrectionRules(): TypoCorrectionRules {
  if (cachedRules !== undefined) return cachedRules;

  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  const rules = parseTypoRules(readFileSync(join(configHome, "fbb/data/typos.abolish"), "utf8"));
  cachedRules = { rules, lengths: typoRuleLengths(rules) };
  return cachedRules;
}

export function correctedPromptForInput(
  input: string,
  data: string,
  typoRules: TypoCorrectionRules,
): string | undefined {
  // Input is decoded by Pi's native editor before reaching the correction hook.
  const delimiter = data;
  if (delimiter !== "" && !isTypoDelimiter(delimiter)) return undefined;

  const corrected = appendDelimiterAndCorrect(input, delimiter, typoRules.rules, typoRules.lengths);
  return corrected === `${input}${delimiter}` ? undefined : corrected;
}

export default function typoAbolish(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    loadTypoCorrectionRules();
  });
}
