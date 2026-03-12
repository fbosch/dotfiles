import { encode } from "@toon-format/toon";
import type { Plugin } from "@opencode-ai/plugin";

const ELIGIBLE_TOOLS = new Set(["bash", "host_exec"]);
const MIN_JSON_OUTPUT_LENGTH = 256;

type ToonEncoder = (value: unknown) => string;

function parseJsonCandidate(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (trimmed.length < MIN_JSON_OUTPUT_LENGTH) {
    return undefined;
  }

  const firstChar = trimmed[0];
  if (firstChar !== "{" && firstChar !== "[") {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

export function tryConvertJsonToToon(text: string, toToon: ToonEncoder = encode): string | undefined {
  const parsed = parseJsonCandidate(text);
  if (parsed === undefined) {
    return undefined;
  }

  try {
    const converted = toToon(parsed);
    if (converted.length < text.length) {
      return converted;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export const ToonFormatPlugin: Plugin = async () => {
  return {
    "tool.execute.after": async (input, output) => {
      const tool = String(input?.tool ?? "").toLowerCase();
      if (ELIGIBLE_TOOLS.has(tool) === false) {
        return;
      }

      const value = output?.output;
      if (typeof value !== "string") {
        return;
      }

      const converted = tryConvertJsonToToon(value);
      if (converted === undefined) {
        return;
      }

      output.output = converted;
    },
  };
};
