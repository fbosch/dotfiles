/**
 * Grammar loading — maps file extensions to tree-sitter WASM grammars,
 * fetches from CDN on first use, caches to disk for offline reuse.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { Language, Parser } from "web-tree-sitter";

// ── Types ────────────────────────────────────────────────────────────────

export interface GrammarEntry {
  pkg: string;
  wasm: string;
}

/** Callback for user-facing notifications about grammar downloads. */
export type NotifyFn = (message: string, level: "info" | "error") => void;

function formatGrammarName(entry: GrammarEntry): string {
  const wasmMatch = entry.wasm.match(/tree-sitter-(\w+)\.wasm/);
  const wasmName = wasmMatch?.[1];
  if (wasmName !== undefined) {
    return wasmName.charAt(0).toUpperCase() + wasmName.slice(1);
  }
  // Fallback: derive from package name
  const name = entry.pkg.replace(/^@.+\//, "").replace(/^tree-sitter-/, "");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// ── Grammar map ─────────────────────────────────────────────────────────

export const LANGUAGE_MAP: Record<string, GrammarEntry> = {
  ".rs": { pkg: "tree-sitter-rust", wasm: "tree-sitter-rust.wasm" },
  ".py": { pkg: "tree-sitter-python", wasm: "tree-sitter-python.wasm" },
  ".pyi": { pkg: "tree-sitter-python", wasm: "tree-sitter-python.wasm" },
  ".ts": { pkg: "tree-sitter-typescript", wasm: "tree-sitter-typescript.wasm" },
  ".tsx": { pkg: "tree-sitter-typescript", wasm: "tree-sitter-tsx.wasm" },
  ".mts": { pkg: "tree-sitter-typescript", wasm: "tree-sitter-typescript.wasm" },
  ".cts": { pkg: "tree-sitter-typescript", wasm: "tree-sitter-typescript.wasm" },
  ".js": { pkg: "tree-sitter-javascript", wasm: "tree-sitter-javascript.wasm" },
  ".jsx": { pkg: "tree-sitter-javascript", wasm: "tree-sitter-javascript.wasm" },
  ".mjs": { pkg: "tree-sitter-javascript", wasm: "tree-sitter-javascript.wasm" },
  ".cjs": { pkg: "tree-sitter-javascript", wasm: "tree-sitter-javascript.wasm" },
  ".go": { pkg: "tree-sitter-go", wasm: "tree-sitter-go.wasm" },
  ".java": { pkg: "tree-sitter-java", wasm: "tree-sitter-java.wasm" },
  ".rb": { pkg: "tree-sitter-ruby", wasm: "tree-sitter-ruby.wasm" },
  ".c": { pkg: "tree-sitter-c", wasm: "tree-sitter-c.wasm" },
  ".cpp": { pkg: "tree-sitter-cpp", wasm: "tree-sitter-cpp.wasm" },
  ".cc": { pkg: "tree-sitter-cpp", wasm: "tree-sitter-cpp.wasm" },
  ".cxx": { pkg: "tree-sitter-cpp", wasm: "tree-sitter-cpp.wasm" },
  ".hpp": { pkg: "tree-sitter-cpp", wasm: "tree-sitter-cpp.wasm" },
  ".hh": { pkg: "tree-sitter-cpp", wasm: "tree-sitter-cpp.wasm" },
  ".hxx": { pkg: "tree-sitter-cpp", wasm: "tree-sitter-cpp.wasm" },
  ".sh": { pkg: "tree-sitter-bash", wasm: "tree-sitter-bash.wasm" },
  ".bash": { pkg: "tree-sitter-bash", wasm: "tree-sitter-bash.wasm" },
  ".css": { pkg: "tree-sitter-css", wasm: "tree-sitter-css.wasm" },
  ".ex": { pkg: "tree-sitter-elixir", wasm: "tree-sitter-elixir.wasm" },
  ".exs": { pkg: "tree-sitter-elixir", wasm: "tree-sitter-elixir.wasm" },
  ".hs": { pkg: "tree-sitter-haskell", wasm: "tree-sitter-haskell.wasm" },
  ".htm": { pkg: "tree-sitter-html", wasm: "tree-sitter-html.wasm" },
  ".html": { pkg: "tree-sitter-html", wasm: "tree-sitter-html.wasm" },
  ".json": { pkg: "tree-sitter-json", wasm: "tree-sitter-json.wasm" },
  ".kt": { pkg: "@tree-sitter-grammars/tree-sitter-kotlin", wasm: "tree-sitter-kotlin.wasm" },
  ".kts": { pkg: "@tree-sitter-grammars/tree-sitter-kotlin", wasm: "tree-sitter-kotlin.wasm" },
  ".lhs": { pkg: "tree-sitter-haskell", wasm: "tree-sitter-haskell.wasm" },
  ".zig": { pkg: "@tree-sitter-grammars/tree-sitter-zig", wasm: "tree-sitter-zig.wasm" },

  // Clojure via yogthos fork (publishes WASM builds)
  ".clj": { pkg: "@yogthos/tree-sitter-clojure", wasm: "tree-sitter-clojure.wasm" },
  ".cljs": { pkg: "@yogthos/tree-sitter-clojure", wasm: "tree-sitter-clojure.wasm" },
  ".cljc": { pkg: "@yogthos/tree-sitter-clojure", wasm: "tree-sitter-clojure.wasm" },
  ".bb": { pkg: "@yogthos/tree-sitter-clojure", wasm: "tree-sitter-clojure.wasm" },
  ".edn": { pkg: "@yogthos/tree-sitter-clojure", wasm: "tree-sitter-clojure.wasm" },
  ".cljd": { pkg: "@yogthos/tree-sitter-clojure", wasm: "tree-sitter-clojure.wasm" },

  // Scheme — includes *.wasm
  ".scm": { pkg: "@6cdh/tree-sitter-scheme", wasm: "tree-sitter-scheme.wasm" },
  ".ss": { pkg: "@6cdh/tree-sitter-scheme", wasm: "tree-sitter-scheme.wasm" },

  // Racket — explicit WASM package
  ".rkt": { pkg: "@lumis-sh/wasm-racket", wasm: "tree-sitter-racket.wasm" },

  // PHP — includes *.wasm in its npm package
  ".php": { pkg: "tree-sitter-php", wasm: "tree-sitter-php.wasm" },

  // Scala — includes *.wasm in its npm package
  ".scala": { pkg: "tree-sitter-scala", wasm: "tree-sitter-scala.wasm" },

  // C# — includes *.wasm
  ".cs": { pkg: "tree-sitter-c-sharp", wasm: "tree-sitter-c_sharp.wasm" },

  // Dart — explicit WASM-only package
  ".dart": { pkg: "@winci/tree-sitter-dart", wasm: "tree-sitter-dart.wasm" },

  // Languages via tree-sitter-wasms (prebuilt WASM bundle)
  // Lua, Swift, TOML, YAML, Vue don't publish WASM in their individual packages
  ".lua": { pkg: "tree-sitter-wasms", wasm: "out/tree-sitter-lua.wasm" },
  ".swift": { pkg: "tree-sitter-wasms", wasm: "out/tree-sitter-swift.wasm" },
  ".toml": { pkg: "tree-sitter-wasms", wasm: "out/tree-sitter-toml.wasm" },
  ".yaml": { pkg: "tree-sitter-wasms", wasm: "out/tree-sitter-yaml.wasm" },
  ".yml": { pkg: "tree-sitter-wasms", wasm: "out/tree-sitter-yaml.wasm" },
  ".vue": { pkg: "tree-sitter-wasms", wasm: "out/tree-sitter-vue.wasm" },
};

// ── CDN + disk cache ────────────────────────────────────────────────────

const WASM_CDN = "https://cdn.jsdelivr.net/npm";
const CACHE_DIR = resolve(homedir(), ".cache", "pi-tree-sitter");
const grammarCache = new Map<string, Language | null>();

/** Ensure the web-tree-sitter WASM runtime is initialized (once). */
let parserInit: Promise<void> | null = null;

export async function ensureParser(): Promise<void> {
  if (!parserInit) {
    parserInit = Parser.init();
  }
  await parserInit;
}

/** How often to revalidate cached grammars against the CDN (30 days in ms). */
const REVALIDATE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** Max retries for CDN fetches. */
const MAX_FETCH_RETRIES = 3;

/** Fetch timeout in ms. */
const FETCH_TIMEOUT_MS = 30_000;

/** Fetch with retries, exponential backoff, and timeout. */
async function fetchWithRetry(url: string, options: RequestInit = {}): Promise<Response> {
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= MAX_FETCH_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        return await fetch(url, { ...options, signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_FETCH_RETRIES) {
        const delay = 1000 * 2 ** (attempt - 1); // 1s, 2s, 4s
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr ?? new Error("fetch failed");
}

/** Resolve a WASM file: disk cache → conditional CDN fetch → return Language or null.
 *
 * - Caches WASM files to disk with the server's ETag and a download date.
 * - Only revalidates against the CDN every 30 days (checks mtime of the date file).
 * - Revalidation uses conditional GET with `If-None-Match`:
 *   304 → touch date file (reset the 30-day timer)
 *   200 → download new version, update cache + etag + date
 * - On network error during revalidation → keep cache, touch date (retry in 30 days).
 * - Fresh downloads retry up to MAX_FETCH_RETRIES times with exponential backoff.
 */
export async function loadGrammar(
  entry: GrammarEntry,
  notify?: NotifyFn,
): Promise<Language | null> {
  const key = `${entry.pkg}/${entry.wasm}`;
  const cached = grammarCache.get(key);
  if (cached !== undefined) return cached;

  const cachePath = resolve(CACHE_DIR, entry.pkg, entry.wasm);
  const datePath = `${cachePath}.date`;
  const etagPath = `${cachePath}.etag`;
  let wasmBytes: Uint8Array | null = null;

  // Helper: save wasm + metadata to disk
  async function saveCache(bytes: Uint8Array, etag: string): Promise<void> {
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, Buffer.from(bytes));
    await writeFile(datePath, Date.now().toString());
    if (etag) await writeFile(etagPath, etag);
  }

  // Helper: touch date file (reset revalidation timer)
  async function touchDate(): Promise<void> {
    try {
      await writeFile(datePath, Date.now().toString());
    } catch {
      /* best-effort */
    }
  }

  // Helper: delete all cache files for this grammar
  async function clearCache(): Promise<void> {
    for (const p of [cachePath, etagPath, datePath]) {
      try {
        await rm(p, { force: true });
      } catch {
        /* best-effort */
      }
    }
  }

  // Helper: try to load Language from bytes; on failure, clear cache so next call re-downloads
  async function tryLoad(bytes: Uint8Array): Promise<Language | null> {
    const lang = await Language.load(bytes).catch(() => null);
    if (lang) {
      grammarCache.set(key, lang);
      return lang;
    }
    grammarCache.set(key, null);
    await clearCache();
    return null;
  }

  // 1. Try reading cached WASM
  const cachedEtag = await readFile(etagPath, "utf-8").catch(() => "");
  wasmBytes = await readFile(cachePath)
    .then((b) => new Uint8Array(b))
    .catch(() => null);
  const cachedDate = await readFile(datePath, "utf-8").catch(() => "");

  if (wasmBytes && cachedEtag && cachedDate) {
    const age = Date.now() - parseInt(cachedDate, 10);
    if (age < REVALIDATE_AFTER_MS) {
      const lang = await tryLoad(wasmBytes);
      if (lang) return lang;
      // Cached bytes are corrupted — fall through to re-download
    } else {
      // 2. Cache is stale — revalidate with conditional GET
      try {
        const url = `${WASM_CDN}/${key}`;
        const res = await fetchWithRetry(url, { headers: { "If-None-Match": cachedEtag } });
        if (res.status === 304) {
          await touchDate();
          if (wasmBytes !== null) {
            const lang = await tryLoad(wasmBytes);
            if (lang) return lang;
          }
        } else if (res.ok) {
          wasmBytes = new Uint8Array(await res.arrayBuffer());
          const newEtag = res.headers.get("etag") || "";
          await saveCache(wasmBytes, newEtag);
          const lang = await tryLoad(wasmBytes);
          if (lang) {
            notify?.(`Tree-sitter grammar for ${formatGrammarName(entry)} updated`, "info");
            return lang;
          }
        } else {
          // Unexpected status (429, 500, etc.) — keep cache, retry in 30 days
          await touchDate();
          const lang = await tryLoad(wasmBytes);
          if (lang) return lang;
        }
      } catch {
        // Network error — keep cached copy, reset timer (retry in 30 days)
        await touchDate();
        const lang = await tryLoad(wasmBytes);
        if (lang) return lang;
      }
    }
  }

  // 3. No cache (or cache corrupted) — fresh download with retry
  for (let attempt = 1; attempt <= MAX_FETCH_RETRIES; attempt++) {
    try {
      const url = `${WASM_CDN}/${key}`;
      const res = await fetchWithRetry(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      wasmBytes = new Uint8Array(await res.arrayBuffer());
      const etag = res.headers.get("etag") || "";
      const lang = await Language.load(wasmBytes).catch(() => null);
      if (lang) {
        await saveCache(wasmBytes, etag);
        grammarCache.set(key, lang);
        notify?.(`Tree-sitter grammar for ${formatGrammarName(entry)} ready`, "info");
        return lang;
      }
      // Downloaded bytes are invalid — try again
    } catch {
      if (attempt < MAX_FETCH_RETRIES) {
        const delay = 1000 * 2 ** (attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  grammarCache.set(key, null);
  notify?.(`Failed to load tree-sitter grammar for ${formatGrammarName(entry)}`, "error");
  return null;
}

/** Get a grammar for a file extension, or null if unknown. */
export async function getLanguage(ext: string): Promise<Language | null> {
  const entry = LANGUAGE_MAP[ext.toLowerCase()];
  if (!entry) return null;
  await ensureParser();
  return loadGrammar(entry);
}
