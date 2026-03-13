import { encode } from "@toon-format/toon";
import type { Plugin } from "@opencode-ai/plugin";

const ELIGIBLE_TOOLS = new Set(["bash", "rtk"]);

const ToonFormatPlugin: Plugin = async () => ({
  "tool.execute.after": async (input, output) => {
    if (ELIGIBLE_TOOLS.has(String(input?.tool ?? "").toLowerCase()) === false)
      return;
    const text = output?.output;
    if (typeof text !== "string") return;

    const trimmed = text.trim();
    if (trimmed.length < 256 || (trimmed[0] !== "{" && trimmed[0] !== "["))
      return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return;
    }

    try {
      const converted = encode(parsed);
      if (converted.length < text.length) output.output = converted;
    } catch {}
  },
});

export default ToonFormatPlugin;
