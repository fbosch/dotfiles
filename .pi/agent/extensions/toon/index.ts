import { createHash } from "node:crypto";
import {
  type ExtensionAPI,
  isToolCallEventType,
  type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { encode } from "@toon-format/toon";

const DEFAULT_ELIGIBLE_TOOLS = ["bash"];
const MAX_CACHED_OUTPUTS = 100;
const MAX_CACHE_BYTES = 8_000_000;
const MAX_JSON_BYTES = 1_000_000;
const MIN_JSON_LENGTH = 256;
const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const TOON_OPTIONS = {
  delimiter: "\t",
  keyFolding: "safe",
} as const;

interface ConvertedOutput {
  bytes: number;
  json: string;
  toon: string;
}

function eligibleTools(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw === undefined ? DEFAULT_ELIGIBLE_TOOLS : raw.split(","))
      .map((tool) => tool.trim().toLowerCase())
      .filter(Boolean),
  );
}

function looksLikeJson(text: string): boolean {
  const first = text.charCodeAt(0);
  const last = text.charCodeAt(text.length - 1);
  return (first === 123 && last === 125) || (first === 91 && last === 93);
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function shellSingleQuote(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function containsUnsafeNumber(text: string): boolean {
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }
    if (character !== "-" && (character === undefined || character < "0" || character > "9")) {
      continue;
    }

    const token = text.slice(index).match(JSON_NUMBER)?.[0];
    if (token === undefined) continue;
    const value = Number(token);
    if (
      Number.isFinite(value) === false ||
      (Number.isInteger(value) && Number.isSafeInteger(value) === false)
    ) {
      return true;
    }
    index += token.length - 1;
  }

  return false;
}

export function createToonTransformer(
  rawEligibleTools: string | undefined = process.env.PI_TOON_EXTENSION_TOOLS,
) {
  const tools = eligibleTools(rawEligibleTools);
  const convertedOutputs = new Map<string, ConvertedOutput>();
  let cachedBytes = 0;

  function cacheConvertedOutput(toon: string, json: string): boolean {
    const hash = hashText(toon);
    const existing = convertedOutputs.get(hash);
    if (existing !== undefined && (existing.toon !== toon || existing.json !== json)) return false;

    if (existing !== undefined) cachedBytes -= existing.bytes;
    convertedOutputs.delete(hash);
    const bytes = Buffer.byteLength(json) + Buffer.byteLength(toon);
    convertedOutputs.set(hash, { bytes, json, toon });
    cachedBytes += bytes;

    while (convertedOutputs.size > MAX_CACHED_OUTPUTS || cachedBytes > MAX_CACHE_BYTES) {
      const oldest = convertedOutputs.keys().next().value;
      if (oldest === undefined) return false;
      cachedBytes -= convertedOutputs.get(oldest)?.bytes ?? 0;
      convertedOutputs.delete(oldest);
    }
    return true;
  }

  function cachedJson(text: string): string | undefined {
    const converted = convertedOutputs.get(hashText(text));
    return converted?.toon === text ? converted.json : undefined;
  }

  function jsonForForwardedText(text: string): string | undefined {
    return cachedJson(text);
  }

  function replaceHeredocs(command: string): string {
    return command.replace(
      /(<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2[^\n]*\n)([\s\S]*?)(\n\3(?:\n|$))/g,
      (match, prefix: string, _quote: string, _marker: string, body: string, suffix: string) => {
        const json = jsonForForwardedText(body.trim());
        return json === undefined ? match : `${prefix}${json}${suffix}`;
      },
    );
  }

  function replaceQuotedPayloads(command: string): string {
    // Double-quoted and concatenated shell words require a real shell parser to decode safely.
    return command.replace(/'([^']*)'/g, (match, body: string) => {
      const json = jsonForForwardedText(body);
      return json === undefined ? match : shellSingleQuote(json);
    });
  }

  return {
    clear(): void {
      convertedOutputs.clear();
      cachedBytes = 0;
    },

    restoreCommand(command: string): string {
      const withHeredocs = replaceHeredocs(command);
      return replaceQuotedPayloads(withHeredocs);
    },

    transformResult(
      event: Pick<ToolResultEvent, "content" | "isError" | "toolName">,
    ): ToolResultEvent["content"] | undefined {
      if (event.isError || tools.has(event.toolName.toLowerCase()) === false) return undefined;
      if (event.content.length !== 1) return undefined;

      const content = event.content[0];
      if (content?.type !== "text") return undefined;

      const json = content.text.trim();
      if (json.length < MIN_JSON_LENGTH || looksLikeJson(json) === false) return undefined;
      if (Buffer.byteLength(json) > MAX_JSON_BYTES || containsUnsafeNumber(json)) return undefined;

      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        return undefined;
      }

      try {
        const toon = encode(parsed, TOON_OPTIONS);
        if (toon.length >= json.length) return undefined;
        if (cacheConvertedOutput(toon, json) === false) return undefined;

        return [{ ...content, text: toon }];
      } catch {
        return undefined;
      }
    },
  };
}

export default function toonExtension(pi: ExtensionAPI): void {
  const transformer = createToonTransformer();

  pi.on("tool_call", (event) => {
    if (isToolCallEventType("bash", event) === false) return;

    const command = transformer.restoreCommand(event.input.command);
    if (command !== event.input.command) event.input.command = command;
  });

  pi.on("tool_result", (event) => {
    const content = transformer.transformResult(event);
    return content === undefined ? undefined : { content };
  });

  pi.on("session_shutdown", () => {
    transformer.clear();
  });
}
