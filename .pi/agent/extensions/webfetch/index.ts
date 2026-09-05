import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const DEFAULT_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 120;
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;
const MAX_TEXT_CHARACTERS = 200_000;
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
  truncated: boolean;
}

interface ValidatedUrl {
  url: URL;
  addresses: readonly string[];
}

type RequestFunction = (
  url: URL,
  addresses: readonly string[],
  headers: Record<string, string>,
  signal: AbortSignal,
) => Promise<Response>;

interface FetchDependencies {
  requestFn?: RequestFunction;
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
  const words = parseIpv6(address);
  if (words === undefined) return true;
  const [first = 0, second = 0, third = 0, fourth = 0, fifth = 0, sixth = 0] = words;

  if (words.every((word) => word === 0)) return true;
  if (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) return true;
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0) return true;
  if ((first & 0xff00) === 0xff00) return true;
  if (first === 0x100 && second === 0 && third === 0 && fourth === 0) return true;
  if (first === 0x2001 && (second === 0x2 || second === 0xdb8)) return true;
  if (first === 0x2002) return true;
  if (first === 0x64 && second === 0xff9b && third === 0 && fourth === 0 && fifth === 0) {
    return true;
  }
  if (first === 0x64 && second === 0xff9b && third === 1) return true;

  const isMappedIpv4 = words.slice(0, 5).every((word) => word === 0) && sixth === 0xffff;
  const isCompatibleIpv4 = words.slice(0, 6).every((word) => word === 0);
  if (!isMappedIpv4 && !isCompatibleIpv4) return false;
  const high = words[6] ?? 0;
  const low = words[7] ?? 0;
  const ipv4 = `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  return isBlockedIpv4(ipv4);
}

function parseIpv6(address: string): number[] | undefined {
  let normalized = (address.toLowerCase().split("%")[0] ?? "").replace(/^\[|\]$/g, "");
  const ipv4Match = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Match !== null) {
    const octets = parseIpv4(ipv4Match[1] ?? "");
    if (octets === undefined) return undefined;
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    normalized = normalized.replace(ipv4Match[1] ?? "", `${(a << 8) | b}:${(c << 8) | d}`);
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return undefined;
  const left = halves[0]?.length === 0 ? [] : (halves[0]?.split(":") ?? []);
  const right = halves[1]?.length === 0 ? [] : (halves[1]?.split(":") ?? []);
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1))
    return undefined;

  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  const words = groups.map((group) => Number.parseInt(group, 16));
  if (
    words.length !== 8 ||
    groups.some((group) => !/^[\da-f]{1,4}$/i.test(group)) ||
    words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)
  ) {
    return undefined;
  }
  return words;
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
  signal: AbortSignal,
): Promise<ValidatedUrl> {
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
    return { url, addresses: [hostname] };
  }
  if (!hostname.includes(".")) throw new Error("Single-label hostnames are not allowed");

  let addresses: readonly string[];
  try {
    addresses = await raceWithAbort(resolveHostname(hostname), signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not resolve ${hostname}: ${message}`);
  }
  if (addresses.length === 0) throw new Error(`Could not resolve ${hostname}`);
  if (addresses.some(isBlockedAddress)) {
    throw new Error("URL resolves to a private or reserved IP address");
  }
  return { url, addresses };
}

function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function responseHeaders(headers: Record<string, string | string[] | undefined>): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item);
      continue;
    }
    if (value !== undefined) result.set(name, value);
  }
  return result;
}

async function requestPinnedUrl(
  url: URL,
  addresses: readonly string[],
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<Response> {
  const address = addresses[0];
  if (address === undefined) throw new Error(`No validated address available for ${url.hostname}`);
  const family = isIP(address);
  if (family !== 4 && family !== 6) throw new Error(`Invalid resolved address: ${address}`);
  const records = addresses.map((candidate) => ({ address: candidate, family: isIP(candidate) }));
  if (records.some((record) => record.family !== 4 && record.family !== 6)) {
    throw new Error(`Invalid resolved address for ${url.hostname}`);
  }

  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const outgoing = request(
      url,
      {
        method: "GET",
        agent: false,
        headers: { ...headers, "Accept-Encoding": "identity", Connection: "close" },
        signal,
        lookup: (_hostname, options, callback) => {
          if (typeof options === "object" && options.all === true) {
            callback(null, records);
            return;
          }
          callback(null, address, family);
        },
      },
      (incoming) => {
        try {
          const status = incoming.statusCode ?? 500;
          const hasNoBody = status === 204 || status === 205 || status === 304;
          const body = hasNoBody
            ? null
            : (Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>);
          const statusText = incoming.statusMessage;
          resolve(
            new Response(body, {
              status,
              ...(statusText === undefined ? {} : { statusText }),
              headers: responseHeaders(incoming.headers),
            }),
          );
        } catch (error) {
          incoming.destroy();
          reject(error);
        }
      },
    );
    outgoing.once("error", reject);
    outgoing.end();
  });
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
  requestFn: RequestFunction,
  resolveHostname: (hostname: string) => Promise<readonly string[]>,
): Promise<{ response: Response; url: URL }> {
  let url = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const validated = await assertPublicUrl(url, resolveHostname, signal);
    url = validated.url;
    const response = await requestFn(
      url,
      validated.addresses,
      {
        Accept: acceptHeader(format),
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36",
      },
      signal,
    );

    if (!REDIRECT_STATUSES.has(response.status)) return { response, url };
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (location === null)
      throw new Error(`HTTP ${response.status} redirect had no Location header`);
    if (redirectCount === MAX_REDIRECTS)
      throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
    const redirectUrl = new URL(location, url);
    if (url.protocol === "https:" && redirectUrl.protocol === "http:") {
      throw new Error("HTTPS redirects to HTTP are not allowed");
    }
    url = redirectUrl;
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

function assertBeforeDeadline(deadline: number): void {
  if (performance.now() > deadline) throw new Error("Request timed out");
}

function sanitizeText(value: string, deadline = Number.POSITIVE_INFINITY): string {
  let result = "";
  let processed = 0;
  for (const character of value) {
    processed += character.length;
    if (processed % 4096 === 0) assertBeforeDeadline(deadline);
    const codePoint = character.codePointAt(0) ?? 0;
    const allowedWhitespace = codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd;
    if (codePoint < 0x20 && !allowedWhitespace) continue;
    if (codePoint >= 0x7f && codePoint <= 0x9f) continue;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue;
    result += character;
  }
  return result;
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
      if (
        !Number.isFinite(codePoint) ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
        (codePoint < 0x20 && codePoint !== 0x9 && codePoint !== 0xa && codePoint !== 0xd) ||
        (codePoint >= 0x7f && codePoint <= 0x9f)
      ) {
        return "";
      }
      return String.fromCodePoint(codePoint);
    },
  );
}

interface HtmlTagToken {
  kind: "tag";
  name: string;
  closing: boolean;
  raw: string;
}

interface HtmlTextToken {
  kind: "text";
  text: string;
}

type HtmlToken = HtmlTagToken | HtmlTextToken;

const SKIPPED_HTML_ELEMENTS = new Set([
  "embed",
  "head",
  "iframe",
  "noscript",
  "object",
  "script",
  "style",
  "svg",
  "template",
]);

function findTagEnd(html: string, start: number): number {
  let quote: '"' | "'" | undefined;
  for (let index = start; index < html.length; index++) {
    const character = html[index];
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return index;
  }
  return -1;
}

function parseTag(raw: string): HtmlTagToken | undefined {
  const trimmed = raw.trim();
  const closing = trimmed.startsWith("/");
  const nameStart = closing ? 1 : 0;
  let nameEnd = nameStart;
  while (nameEnd < trimmed.length && /[\da-z-]/i.test(trimmed[nameEnd] ?? "")) nameEnd += 1;
  if (nameEnd === nameStart) return undefined;
  return { kind: "tag", name: trimmed.slice(nameStart, nameEnd).toLowerCase(), closing, raw };
}

function tokenizeHtml(
  html: string,
  consume: (token: HtmlToken) => void,
  deadline = Number.POSITIVE_INFINITY,
): void {
  const lowercase = html.toLowerCase();
  let position = 0;
  while (position < html.length) {
    assertBeforeDeadline(deadline);
    const tagStart = html.indexOf("<", position);
    if (tagStart < 0) {
      consume({ kind: "text", text: html.slice(position) });
      return;
    }
    if (tagStart > position) consume({ kind: "text", text: html.slice(position, tagStart) });

    if (html.startsWith("<!--", tagStart)) {
      const commentEnd = html.indexOf("-->", tagStart + 4);
      if (commentEnd < 0) return;
      position = commentEnd + 3;
      continue;
    }

    const tagEnd = findTagEnd(html, tagStart + 1);
    if (tagEnd < 0) {
      consume({ kind: "text", text: html.slice(tagStart) });
      return;
    }

    const token = parseTag(html.slice(tagStart + 1, tagEnd));
    if (token === undefined) {
      const raw = html.slice(tagStart + 1, tagEnd).trimStart();
      if (!raw.startsWith("!") && !raw.startsWith("?")) {
        consume({ kind: "text", text: html.slice(tagStart, tagEnd + 1) });
      }
      position = tagEnd + 1;
      continue;
    }

    if (!token.closing && SKIPPED_HTML_ELEMENTS.has(token.name)) {
      const closingStart = lowercase.indexOf(`</${token.name}`, tagEnd + 1);
      if (closingStart < 0 && token.name === "head") {
        const bodyStart = lowercase.indexOf("<body", tagEnd + 1);
        if (bodyStart >= 0) {
          position = bodyStart;
          continue;
        }
      }
      if (closingStart < 0) return;
      const closingEnd = findTagEnd(html, closingStart + 2 + token.name.length);
      if (closingEnd < 0) return;
      position = closingEnd + 1;
      continue;
    }

    consume(token);
    position = tagEnd + 1;
  }
}

function normalizedText(value: string, deadline: number): string {
  return sanitizeText(decodeHtmlEntities(value), deadline).replace(/\s+/g, " ");
}

function normalizeRenderedText(value: string): string {
  return value
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function attributeValue(raw: string, attributeName: string, deadline: number): string | undefined {
  let position = 0;
  while (position < raw.length) {
    assertBeforeDeadline(deadline);
    while (position < raw.length && /[\s/]/.test(raw[position] ?? "")) position += 1;
    const nameStart = position;
    while (position < raw.length && /[^\s=/>]/.test(raw[position] ?? "")) position += 1;
    // Malformed attribute syntax must not leave the scanner at the same character.
    if (position === nameStart) return undefined;
    const name = raw.slice(nameStart, position).toLowerCase();
    while (position < raw.length && /\s/.test(raw[position] ?? "")) position += 1;
    if (raw[position] !== "=") continue;
    position += 1;
    while (position < raw.length && /\s/.test(raw[position] ?? "")) position += 1;

    const quote = raw[position] === '"' || raw[position] === "'" ? raw[position] : undefined;
    if (quote !== undefined) position += 1;
    const valueStart = position;
    if (quote === undefined) {
      while (position < raw.length && /[^\s>]/.test(raw[position] ?? "")) position += 1;
    } else {
      while (position < raw.length && raw[position] !== quote) position += 1;
    }
    const value = raw.slice(valueStart, position);
    if (quote !== undefined && raw[position] === quote) position += 1;
    if (name === attributeName) return value;
  }
  return undefined;
}

function resolvedLink(raw: string, baseUrl: URL, deadline: number): string | undefined {
  const href = attributeValue(raw, "href", deadline);
  if (href === undefined) return undefined;
  try {
    const url = new URL(decodeHtmlEntities(href), baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function htmlToText(html: string, deadline = Number.POSITIVE_INFINITY): string {
  let output = "";
  const blockElements = new Set([
    "address",
    "article",
    "aside",
    "blockquote",
    "div",
    "footer",
    "header",
    "li",
    "main",
    "nav",
    "p",
    "section",
    "tr",
    "ul",
    "ol",
  ]);
  tokenizeHtml(
    html,
    (token) => {
      if (token.kind === "text") {
        output += normalizedText(token.text, deadline);
        return;
      }
      if (token.name === "br") output += "\n";
      if (token.closing && (blockElements.has(token.name) || /^h[1-6]$/.test(token.name))) {
        output += "\n";
      }
    },
    deadline,
  );
  return normalizeRenderedText(output);
}

export function htmlToMarkdown(
  html: string,
  baseUrl = new URL("https://invalid.example"),
  deadline = Number.POSITIVE_INFINITY,
): string {
  let output = "";
  let preformatted = false;
  const links: Array<string | undefined> = [];
  const blocks = new Set([
    "address",
    "article",
    "aside",
    "div",
    "footer",
    "header",
    "main",
    "nav",
    "p",
    "section",
    "table",
    "tr",
    "ul",
    "ol",
  ]);

  tokenizeHtml(
    html,
    (token) => {
      if (token.kind === "text") {
        output += preformatted
          ? sanitizeText(decodeHtmlEntities(token.text), deadline)
          : normalizedText(token.text, deadline);
        return;
      }

      const { name, closing } = token;
      if (/^h[1-6]$/.test(name)) {
        output += closing ? "\n\n" : `\n\n${"#".repeat(Number(name[1]))} `;
        return;
      }
      if (name === "a") {
        if (!closing) {
          const link = resolvedLink(token.raw, baseUrl, deadline);
          links.push(link);
          if (link !== undefined) output += "[";
        } else {
          const link = links.pop();
          if (link !== undefined) output += `](${link})`;
        }
        return;
      }
      if (name === "pre") {
        preformatted = !closing;
        output += closing ? "\n````\n\n" : "\n\n````\n";
        return;
      }
      if (name === "code" && !preformatted) output += "`";
      if (name === "strong" || name === "b") output += "**";
      if (name === "em" || name === "i") output += "*";
      if (name === "del" || name === "s") output += "~~";
      if (name === "blockquote") output += closing ? "\n\n" : "\n\n> ";
      if (name === "li" && !closing) output += "\n- ";
      if (name === "br") output += "\n";
      if (name === "hr") output += "\n\n---\n\n";
      if (blocks.has(name)) output += "\n\n";
    },
    deadline,
  );

  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function responseSignal(signal: AbortSignal | undefined, timeoutSeconds: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutSeconds * 1_000);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

function contentTypeOf(response: Response): string {
  return response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function charsetOf(response: Response): string {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.match(/(?:^|;)\s*charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] ?? "utf-8";
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

function truncateAtCodePoint(value: string, maxCharacters: number): string {
  let end = Math.min(value.length, maxCharacters);
  const last = value.charCodeAt(end - 1);
  const next = value.charCodeAt(end);
  if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1;
  return value.slice(0, end);
}

export async function fetchWebContent(
  params: WebFetchParams,
  signal?: AbortSignal,
  dependencies: FetchDependencies = {},
) {
  const format = params.format ?? "markdown";
  const timeout = Math.min(params.timeout ?? DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS);
  const deadline = performance.now() + timeout * 1_000;
  const signalWithTimeout = responseSignal(signal, timeout);
  const requestFn = dependencies.requestFn ?? requestPinnedUrl;
  const resolveHostname = dependencies.resolveHostname ?? defaultResolveHostname;
  const initialUrl = new URL(params.url);
  const { response, url } = await fetchWithRedirects(
    initialUrl,
    format,
    signalWithTimeout,
    requestFn,
    resolveHostname,
  );

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = contentTypeOf(response);
  if (!SUPPORTED_IMAGE_TYPES.has(contentType) && !isTextContentType(contentType)) {
    await response.body?.cancel();
    throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
  }
  const bytes = await readBoundedBody(response);
  const details: WebFetchDetails = {
    url: url.toString(),
    contentType,
    bytes: bytes.byteLength,
    truncated: false,
  };

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

  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charsetOf(response));
  } catch {
    decoder = new TextDecoder();
  }
  const raw = sanitizeText(decoder.decode(bytes), deadline);
  assertBeforeDeadline(deadline);
  const isHtml = contentType === "text/html" || contentType === "application/xhtml+xml";
  const text =
    format === "html"
      ? raw
      : format === "text" && isHtml
        ? htmlToText(raw, deadline)
        : format === "markdown" && isHtml
          ? htmlToMarkdown(raw, url, deadline)
          : raw;
  assertBeforeDeadline(deadline);

  if (text.length <= MAX_TEXT_CHARACTERS) {
    return { content: [{ type: "text" as const, text }], details };
  }

  details.truncated = true;
  return {
    content: [
      {
        type: "text" as const,
        text: `${truncateAtCodePoint(text, MAX_TEXT_CHARACTERS)}\n\n[Truncated after ${MAX_TEXT_CHARACTERS} characters]`,
      },
    ],
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
      executionMode: "sequential",

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
