import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type KeyId, matchesKey } from "@earendil-works/pi-tui";
import { appendDelimiterAndCorrect, parseTypoRules, typoRuleLengths } from "./typo-engine";

const TYPO_DELIMITERS = [
  { key: "space", value: " " },
  { key: ".", value: "." },
  { key: ",", value: "," },
  { key: "!", value: "!" },
  { key: "?", value: "?" },
  { key: ":", value: ":" },
  { key: ";", value: ";" },
] as const satisfies readonly { key: KeyId; value: string }[];

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
  const delimiter = TYPO_DELIMITERS.find(({ key }) => matchesKey(data, key))?.value;
  if (delimiter === undefined) return undefined;

  const corrected = appendDelimiterAndCorrect(input, delimiter, typoRules.rules, typoRules.lengths);
  return corrected === `${input}${delimiter}` ? undefined : corrected;
}

export default function typoAbolish(_pi: ExtensionAPI): void {
  loadTypoCorrectionRules();
}
