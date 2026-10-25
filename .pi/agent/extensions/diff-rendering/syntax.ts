import { Buffer } from "node:buffer";
import {
  type BundledLanguage,
  bundledLanguages,
  bundledLanguagesInfo,
  bundledThemes,
  createHighlighter,
  type ThemedToken,
} from "shiki";
import { DEFAULT_SYNTAX_THEME } from "./shared";
import { zenwrittenTheme } from "./zenwritten-theme";

export interface SyntaxToken {
  readonly content: string;
  readonly color?: string;
  readonly fontStyle?: number;
}

export interface HighlightResult {
  readonly lines: readonly (readonly SyntaxToken[])[];
  readonly warning?: string;
}

const COMMON_LANGUAGES: readonly BundledLanguage[] = [
  "typescript",
  "javascript",
  "json",
  "bash",
  "python",
  "lua",
  "nix",
];
const MAX_CODE_BYTES = 64 * 1024;
const MAX_CODE_LINES = 4_000;
const MAX_CACHE_ENTRIES = 128;
const MAX_CACHE_CONTENT_BYTES = 2 * 1024 * 1024;
const RESOURCE_LIMIT_WARNING =
  "Syntax highlighting skipped: input exceeds resource limits (64 KiB or 4,000 lines); showing plain text.";
const UNKNOWN_LANGUAGE_WARNING =
  "Syntax highlighting skipped: unknown language; showing plain text.";

const languageByName = new Map<string, string>();
for (const info of bundledLanguagesInfo) {
  languageByName.set(info.id.toLowerCase(), info.id);
  for (const alias of info.aliases ?? []) {
    if (!languageByName.has(alias.toLowerCase())) languageByName.set(alias.toLowerCase(), info.id);
  }
}

function isBundledLanguage(language: string): language is BundledLanguage {
  return Object.hasOwn(bundledLanguages, language);
}

const filenameLanguages: Readonly<Record<string, string>> = {
  "cmakelists.txt": "cmake",
  dockerfile: "dockerfile",
  makefile: "makefile",
  justfile: "just",
  ".bashrc": "bash",
  ".zshrc": "bash",
};

interface CacheEntry {
  readonly result: HighlightResult;
  readonly retainedBytes: number;
}

type Highlighter = Awaited<ReturnType<typeof createHighlighter>>;

function freezeResult(
  lines: readonly (readonly SyntaxToken[])[],
  warning?: string,
): HighlightResult {
  const frozenLines = Object.freeze(
    lines.map((line) => Object.freeze(line.map((token) => Object.freeze(token)))),
  );
  return warning === undefined ? { lines: frozenLines } : { lines: frozenLines, warning };
}

function plainTextResult(code: string, warning: string): HighlightResult {
  return freezeResult(
    code.split("\n").map((content) => (content === "" ? [] : [{ content }])),
    warning,
  );
}

function countLines(code: string): number {
  let count = 1;
  for (const character of code) {
    if (character === "\n") count += 1;
  }
  return count;
}

function languageForPath(path: string): BundledLanguage | undefined {
  const basename = path.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase() ?? "";
  const dot = basename.lastIndexOf(".");
  const identifier = filenameLanguages[basename] ?? (dot > 0 ? basename.slice(dot + 1) : basename);
  const language = languageByName.get(identifier);
  return language !== undefined && isBundledLanguage(language) ? language : undefined;
}

function unknownLanguageKey(path: string): string {
  const basename = path.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase() ?? "";
  const dot = basename.lastIndexOf(".");
  return dot > 0 ? basename.slice(dot + 1) : basename || "unknown";
}

function toSyntaxToken(token: ThemedToken): SyntaxToken {
  return {
    content: token.content,
    ...(token.color === undefined ? {} : { color: token.color }),
    ...(token.fontStyle === undefined ? {} : { fontStyle: token.fontStyle }),
  };
}

function highlightedLines(
  code: string,
  tokens: readonly (readonly ThemedToken[])[],
): HighlightResult {
  const sourceLines = code.split("\n");
  const lines = sourceLines.map((sourceLine, index) => {
    const line = (tokens[index] ?? []).map(toSyntaxToken);
    const tokenContent = line.map((token) => token.content).join("");
    if (tokenContent === sourceLine) return line;

    // Shiki omits carriage returns from CRLF token rows; retain any unmatched source exactly.
    if (sourceLine.startsWith(tokenContent)) {
      const remainder = sourceLine.slice(tokenContent.length);
      if (remainder === "") return line;
      if (line.length === 0) return [{ content: remainder }];
      const lastIndex = line.length - 1;
      const lastToken = line[lastIndex];
      if (lastToken !== undefined) {
        line[lastIndex] = { ...lastToken, content: lastToken.content + remainder };
        return line;
      }
    }

    return sourceLine === "" ? [] : [{ content: sourceLine }];
  });
  return freezeResult(lines);
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function waitForSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };

    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        if (signal.aborted) reject(abortError());
        else resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function inputWithinLimits(code: string, byteLength: number): boolean {
  return byteLength <= MAX_CODE_BYTES && countLines(code) <= MAX_CODE_LINES;
}

export function createSyntaxHighlighter(themeName = DEFAULT_SYNTAX_THEME): {
  prewarm(): Promise<void>;
  highlight(code: string, path: string, signal?: AbortSignal): Promise<HighlightResult>;
  dispose(): Promise<void>;
} {
  const isCustomTheme = themeName === zenwrittenTheme.name;
  if (!isCustomTheme && !Object.hasOwn(bundledThemes, themeName)) {
    throw new Error(`Unknown Shiki theme "${themeName}"`);
  }

  let disposed = false;
  let highlighterPromise: Promise<Highlighter> | undefined;
  let prewarmPromise: Promise<void> | undefined;
  let disposePromise: Promise<void> | undefined;
  const languageLoads = new Map<string, Promise<void>>();
  const pendingLanguageLoads = new Set<Promise<void>>();
  const cache = new Map<string, CacheEntry>();
  let cacheContentBytes = 0;

  function assertActive(): void {
    if (disposed) throw new Error("Syntax highlighter has been disposed");
  }

  function getHighlighter(): Promise<Highlighter> {
    assertActive();
    if (highlighterPromise === undefined) {
      const themes = isCustomTheme ? [zenwrittenTheme] : [themeName];
      highlighterPromise = createHighlighter({ themes, langs: [] });
    }
    return highlighterPromise;
  }

  function loadLanguage(language: BundledLanguage): Promise<void> {
    assertActive();
    const current = languageLoads.get(language);
    if (current !== undefined) return current;

    const pending = getHighlighter().then(async (highlighter) => {
      assertActive();
      await highlighter.loadLanguage(language);
    });
    languageLoads.set(language, pending);
    pendingLanguageLoads.add(pending);
    void pending.then(
      () => pendingLanguageLoads.delete(pending),
      () => {
        pendingLanguageLoads.delete(pending);
        if (languageLoads.get(language) === pending) languageLoads.delete(language);
      },
    );
    return pending;
  }

  function cachedResult(key: string): HighlightResult | undefined {
    const entry = cache.get(key);
    if (entry === undefined) return undefined;
    cache.delete(key);
    cache.set(key, entry);
    return entry.result;
  }

  function remember(key: string, result: HighlightResult): void {
    const tokenBytes = result.lines.reduce(
      (total, line) =>
        total + line.reduce((lineTotal, token) => lineTotal + Buffer.byteLength(token.content), 0),
      0,
    );
    const retainedBytes = Buffer.byteLength(key) + tokenBytes;
    if (retainedBytes > MAX_CACHE_CONTENT_BYTES) return;

    const previous = cache.get(key);
    if (previous !== undefined) {
      cacheContentBytes -= previous.retainedBytes;
      cache.delete(key);
    }
    cache.set(key, { result, retainedBytes });
    cacheContentBytes += retainedBytes;

    while (cache.size > MAX_CACHE_ENTRIES || cacheContentBytes > MAX_CACHE_CONTENT_BYTES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = cache.get(oldestKey);
      if (oldest !== undefined) cacheContentBytes -= oldest.retainedBytes;
      cache.delete(oldestKey);
    }
  }

  return {
    prewarm(): Promise<void> {
      if (disposed) return Promise.reject(new Error("Syntax highlighter has been disposed"));
      if (prewarmPromise === undefined) {
        prewarmPromise = Promise.all(COMMON_LANGUAGES.map(loadLanguage)).then(() => undefined);
      }
      return prewarmPromise;
    },

    async highlight(code, path, signal): Promise<HighlightResult> {
      assertActive();
      signal?.throwIfAborted();

      const language = languageForPath(path);
      const byteLength = Buffer.byteLength(code);
      const withinLimits = inputWithinLimits(code, byteLength);
      const cacheable = withinLimits;
      const cacheLanguage = language ?? `unknown:${unknownLanguageKey(path)}`;
      const key = cacheable ? JSON.stringify([themeName, cacheLanguage, code]) : undefined;

      if (key !== undefined) {
        const cached = cachedResult(key);
        if (cached !== undefined) return cached;
      }

      if (!withinLimits) {
        const result = plainTextResult(code, RESOURCE_LIMIT_WARNING);
        if (key !== undefined) remember(key, result);
        return result;
      }

      if (language === undefined) {
        const result = plainTextResult(code, UNKNOWN_LANGUAGE_WARNING);
        if (key !== undefined) remember(key, result);
        return result;
      }

      await waitForSignal(loadLanguage(language), signal);
      assertActive();
      signal?.throwIfAborted();

      const highlighter = await waitForSignal(getHighlighter(), signal);
      const result = highlightedLines(
        code,
        highlighter.codeToTokens(code, { lang: language, theme: themeName }).tokens,
      );
      signal?.throwIfAborted();

      if (key !== undefined) remember(key, result);
      return result;
    },

    dispose(): Promise<void> {
      if (disposePromise !== undefined) return disposePromise;

      disposed = true;
      cache.clear();
      cacheContentBytes = 0;
      languageLoads.clear();

      const pendingLoads = [...pendingLanguageLoads];
      const pendingHighlighter = highlighterPromise;
      disposePromise = (async () => {
        await Promise.allSettled(pendingLoads);
        if (pendingHighlighter === undefined) return;
        try {
          (await pendingHighlighter).dispose();
        } catch {
          // Initialization failed before an instance existed to release.
        }
      })();
      return disposePromise;
    },
  };
}
