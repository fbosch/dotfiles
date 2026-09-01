import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const DEFAULT_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 120;
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;
const MAX_REDIRECTS = 10;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SUPPORTED_IMAGE_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

export type WebFetchFormat = "text" | "markdown" | "html";

export interface WebFetchParams {
  url: string;
  format?: WebFetchFormat;
  timeout?: number;
}

interface WebFetchDetails {
  url: string;
  contentType: string;
  bytes: number;
}

type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface FetchDependencies {
  fetchFn?: FetchFunction;
  resolveHostname?: (hostname: string) => Promise<readonly string[]>;
}

const WebFetchParamsSchema = {
  "~kind": "Object" as const,
  type: "object" as const,
  required: ["url"] as const,
  properties: {
    url: {
      "~kind": "String" as const,
      type: "string" as const,
      minLength: 1,
      description: "HTTP or HTTPS URL to fetch.",
    },
    format: {
      "~kind": "Union" as const,
      "~optional": true as const,
      anyOf: [
        { "~kind": "Literal" as const, const: "text" as const, type: "string" as const },
        { "~kind": "Literal" as const, const: "markdown" as const, type: "string" as const },
        { "~kind": "Literal" as const, const: "html" as const, type: "string" as const },
      ],
      description: "Output format (default: markdown).",
    },
    timeout: {
      "~kind": "Number" as const,
      "~optional": true as const,
      type: "number" as const,
      minimum: 1,
      maximum: MAX_TIMEOUT_SECONDS,
      description: "Timeout in seconds (default: 30, max: 120).",
    },
  },
};

function parseIpv4(address: string): number[] | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;

  const octets = parts.map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return undefined;
  }
  return octets;
}

function isBlockedIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (octets === undefined) return true;
  const [first = 0, second = 0, third = 0] = octets;

  if (first === 0 || first === 10 || first === 127) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 0 && third === 0) return true;
  if (first === 192 && second === 0 && third === 2) return true;
  if (first === 192 && second === 168) return true;
  if (first === 198 && (second === 18 || second === 19 || second === 51)) return true;
  if (first === 203 && second === 0 && third === 113) return true;
  return first >= 224;
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? "";
  if (normalized === "::" || normalized === "::1" || normalized.startsWith("::ffff:")) {
    return true;
  }
  if (normalized.startsWith("::")) return true;
  if (/^f[cd]/.test(normalized) || /^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith("ff")) return true;
  if (normalized.startsWith("100:")) return true;
  return normalized.startsWith("2001:2:") || normalized.startsWith("2001:db8:");
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

async function defaultResolveHostname(hostname: string): Promise<readonly string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

async function assertPublicUrl(
  value: string | URL,
  resolveHostname: (hostname: string) => Promise<readonly string[]>,
): Promise<URL> {
  const url = value instanceof URL ? value : new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must start with http:// or https://");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error("URLs containing credentials are not allowed");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Local network URLs are not allowed");
  }

  if (isIP(hostname) !== 0) {
    if (isBlockedAddress(hostname))
      throw new Error("Private or reserved IP addresses are not allowed");
    return url;
  }
  if (!hostname.includes(".")) throw new Error("Single-label hostnames are not allowed");

  let addresses: readonly string[];
  try {
    addresses = await resolveHostname(hostname);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not resolve ${hostname}: ${message}`);
  }
  if (addresses.length === 0) throw new Error(`Could not resolve ${hostname}`);
  if (addresses.some(isBlockedAddress)) {
    throw new Error("URL resolves to a private or reserved IP address");
  }
  return url;
}

function acceptHeader(format: WebFetchFormat): string {
  if (format === "markdown") {
    return "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1";
  }
  if (format === "text") {
    return "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1";
  }
  return "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, */*;q=0.1";
}

async function fetchWithRedirects(
  initialUrl: URL,
  format: WebFetchFormat,
  signal: AbortSignal,
  fetchFn: FetchFunction,
  resolveHostname: (hostname: string) => Promise<readonly string[]>,
): Promise<{ response: Response; url: URL }> {
  let url = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    url = await assertPublicUrl(url, resolveHostname);
    const response = await fetchFn(url, {
      redirect: "manual",
      signal,
      headers: {
        Accept: acceptHeader(format),
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36",
      },
    });

    if (!REDIRECT_STATUSES.has(response.status)) return { response, url };
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (location === null)
      throw new Error(`HTTP ${response.status} redirect had no Location header`);
    if (redirectCount === MAX_REDIRECTS)
      throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
    url = new URL(location, url);
  }

  throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_SIZE) {
    await response.body?.cancel();
    throw new Error("Response too large (exceeds 5 MiB)");
  }
  if (response.body === null) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_SIZE) {
      await reader.cancel();
      throw new Error("Response too large (exceeds 5 MiB)");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function decodeHtmlEntities(value: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi,
    (match, entity: string) => {
      if (!entity.startsWith("#")) return entities[entity.toLowerCase()] ?? match;
      const hexadecimal = entity[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      if (!Number.isFinite(codePoint) || codePoint > 0x10ffff) return match;
      return String.fromCodePoint(codePoint);
    },
  );
}

function removeNonContentHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<(script|style|noscript|iframe|object|embed|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi,
      "",
    )
    .replace(/<(meta|link)\b[^>]*\/?\s*>/gi, "");
}

function stripTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, ""));
}

export function htmlToText(html: string): string {
  return decodeHtmlEntities(
    removeNonContentHtml(html)
      .replace(/<br\b[^>]*>/gi, "\n")
      .replace(
        /<\/(address|article|aside|blockquote|div|footer|h[1-6]|header|li|main|nav|p|section|tr|ul|ol)>/gi,
        "\n",
      )
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function markdownLink(label: string, href: string, baseUrl: URL): string {
  const text = stripTags(label).trim();
  if (text.length === 0) return "";
  try {
    const url = new URL(decodeHtmlEntities(href), baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return text;
    return `[${text}](${url.toString()})`;
  } catch {
    return text;
  }
}

export function htmlToMarkdown(html: string, baseUrl = new URL("https://invalid.example")): string {
  const preformatted: string[] = [];
  let markdown = removeNonContentHtml(html).replace(
    /<pre\b[^>]*>([\s\S]*?)<\/pre>/gi,
    (_match, content: string) => {
      const index = preformatted.push(stripTags(content).trim()) - 1;
      return `\n\nPIWEBFETCHPRE${index}TOKEN\n\n`;
    },
  );

  markdown = markdown
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level: string, content: string) => {
      return `\n\n${"#".repeat(Number(level))} ${stripTags(content).trim()}\n\n`;
    })
    .replace(
      /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_match, href: string, label: string) => {
        return markdownLink(label, href, baseUrl);
      },
    )
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
    .replace(/<(del|s)\b[^>]*>([\s\S]*?)<\/\1>/gi, "~~$2~~")
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_match, content: string) => {
      return `\`${stripTags(content).trim()}\``;
    })
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_match, content: string) => {
      return `\n- ${stripTags(content).trim()}`;
    })
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_match, content: string) => {
      return `\n\n${stripTags(content)
        .trim()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n\n`;
    })
    .replace(/<hr\b[^>]*>/gi, "\n\n---\n\n")
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(
      /<\/(address|article|aside|div|footer|header|main|nav|p|section|table|tr|ul|ol)>/gi,
      "\n\n",
    )
    .replace(/<[^>]*>/g, "");

  markdown = decodeHtmlEntities(markdown)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return markdown.replace(/PIWEBFETCHPRE(\d+)TOKEN/g, (_match, index: string) => {
    return `\n\n\`\`\`\n${preformatted[Number(index)] ?? ""}\n\`\`\`\n\n`;
  });
}

function responseSignal(signal: AbortSignal | undefined, timeoutSeconds: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutSeconds * 1_000);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

function contentTypeOf(response: Response): string {
  return response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function isTextContentType(contentType: string): boolean {
  return (
    contentType.length === 0 ||
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    contentType.endsWith("+json") ||
    contentType === "application/xml" ||
    contentType.endsWith("+xml") ||
    contentType === "application/javascript"
  );
}

export async function fetchWebContent(
  params: WebFetchParams,
  signal?: AbortSignal,
  dependencies: FetchDependencies = {},
) {
  const format = params.format ?? "markdown";
  const timeout = Math.min(params.timeout ?? DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS);
  const fetchFn = dependencies.fetchFn ?? fetch;
  const resolveHostname = dependencies.resolveHostname ?? defaultResolveHostname;
  const initialUrl = await assertPublicUrl(params.url, resolveHostname);
  const { response, url } = await fetchWithRedirects(
    initialUrl,
    format,
    responseSignal(signal, timeout),
    fetchFn,
    resolveHostname,
  );

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = contentTypeOf(response);
  const bytes = await readBoundedBody(response);
  const details: WebFetchDetails = { url: url.toString(), contentType, bytes: bytes.byteLength };

  if (SUPPORTED_IMAGE_TYPES.has(contentType)) {
    return {
      content: [
        { type: "text" as const, text: `Image fetched from ${url.toString()}` },
        {
          type: "image" as const,
          data: Buffer.from(bytes).toString("base64"),
          mimeType: contentType,
        },
      ],
      details,
    };
  }
  if (!isTextContentType(contentType)) {
    throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
  }

  const raw = new TextDecoder().decode(bytes);
  const isHtml = contentType === "text/html" || contentType === "application/xhtml+xml";
  const text =
    format === "html"
      ? raw
      : format === "text" && isHtml
        ? htmlToText(raw)
        : format === "markdown" && isHtml
          ? htmlToMarkdown(raw, url)
          : raw;

  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

export default function webFetchExtension(pi: ExtensionAPI): void {
  pi.registerTool(
    defineTool<typeof WebFetchParamsSchema, WebFetchDetails>({
      name: "webfetch",
      label: "Web Fetch",
      description:
        "Fetch an HTTP(S) URL and return text, markdown, HTML, or a supported image. Responses are limited to 5 MiB and 120 seconds.",
      promptSnippet: "Fetch a specific URL as markdown, text, HTML, or an image",
      promptGuidelines: [
        "Use webfetch to open authoritative URLs returned by websearch.",
        "Prefer markdown unless raw HTML or plain text is specifically required.",
      ],
      parameters: WebFetchParamsSchema,
      executionMode: "parallel",

      async execute(_toolCallId, params, signal) {
        return fetchWebContent(params, signal);
      },

      renderCall(args, theme) {
        return new Text(
          `${theme.fg("toolTitle", theme.bold("webfetch "))}${theme.fg("accent", args.url)}`,
          0,
          0,
        );
      },

      renderResult(result, _options, theme) {
        return new Text(
          theme.fg("success", `${result.details.url} (${result.details.bytes} bytes)`),
          0,
          0,
        );
      },
    }),
  );
}
