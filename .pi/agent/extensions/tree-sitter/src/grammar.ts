/**
 * Grammar loading — maps file extensions to tree-sitter WASM grammars,
 * fetches from CDN on first use, caches to disk for offline reuse.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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

  // Scheme — compatible WASM build of @6cdh/tree-sitter-scheme
  ".scm": { pkg: "@lumis-sh/wasm-scheme", wasm: "tree-sitter-scheme.wasm" },
  ".ss": { pkg: "@lumis-sh/wasm-scheme", wasm: "tree-sitter-scheme.wasm" },

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

// ── Pinned grammar artifacts + disk cache ────────────────────────────────

const WASM_CDN = "https://cdn.jsdelivr.net/npm";
const CACHE_DIR = resolve(homedir(), ".cache", "pi-tree-sitter");

interface GrammarArtifact {
  readonly version: string;
  readonly sha256: string;
}

// These executable WASM assets are pinned separately from the extension so a
// CDN or package update cannot silently change the parser loaded by Pi.
const GRAMMAR_ARTIFACTS: Record<string, GrammarArtifact> = {
  "@lumis-sh/wasm-racket/tree-sitter-racket.wasm": {
    version: "0.26.3",
    sha256: "2353b094c38d29c4b46a3f2a5f79f76abaa39aef595175cfd4eb7a3107506b59",
  },
  "@lumis-sh/wasm-scheme/tree-sitter-scheme.wasm": {
    version: "0.26.2",
    sha256: "128a9ee019b51461c9c829a51af81ca9a70e8c28673ac711cb6f391d5a71ef6f",
  },
  "@tree-sitter-grammars/tree-sitter-kotlin/tree-sitter-kotlin.wasm": {
    version: "1.1.0",
    sha256: "7009d69453bc8735e438b2818a633efb21c88f99782769abba60dffedfab73f7",
  },
  "@tree-sitter-grammars/tree-sitter-zig/tree-sitter-zig.wasm": {
    version: "1.1.2",
    sha256: "54b3b83dd9c62da5815f06132bc3fc914d9dcc780370b32416446a0b7969e8c6",
  },
  "@winci/tree-sitter-dart/tree-sitter-dart.wasm": {
    version: "1.0.0",
    sha256: "be45b7cc41f1a6dc66f8bcf8af90d665912fc7323b80371b96a595552b1ca64d",
  },
  "@yogthos/tree-sitter-clojure/tree-sitter-clojure.wasm": {
    version: "0.0.14",
    sha256: "90f8866b74d04e1643ed73cce25720c732df2aaa38b45da9dcc773bae8181c27",
  },
  "tree-sitter-bash/tree-sitter-bash.wasm": {
    version: "0.25.1",
    sha256: "8292919c88a0f7d3fb31d0cd0253ca5a9531bc1ede82b0537f2c63dd8abe6a7a",
  },
  "tree-sitter-c-sharp/tree-sitter-c_sharp.wasm": {
    version: "0.23.5",
    sha256: "6f69e1cae44e1c32c1eccc170dc5a9778fb94ff716f71113fe1f8c4299aa2f40",
  },
  "tree-sitter-c/tree-sitter-c.wasm": {
    version: "0.24.1",
    sha256: "c852c2a85ebf2beb636aa3b0ef7f7e70458684d74f6741b20dcb296885bed9f9",
  },
  "tree-sitter-cpp/tree-sitter-cpp.wasm": {
    version: "0.23.4",
    sha256: "174eb0deb75b2ec7881bcacda9f995648d8e683956e5c2267e69ab6dc503fcbf",
  },
  "tree-sitter-css/tree-sitter-css.wasm": {
    version: "0.25.0",
    sha256: "8a23977fe271357cce6f254ef88c9bebf3854602d8046605aef6a45c02135c59",
  },
  "tree-sitter-elixir/tree-sitter-elixir.wasm": {
    version: "0.3.5",
    sha256: "ed99093c548c12d43f7e337fd3440e9e2daa2ec671a5e29aadb6c6dcb2232a62",
  },
  "tree-sitter-go/tree-sitter-go.wasm": {
    version: "0.25.0",
    sha256: "9504573f352b20be7f2f1911754d710622aedc15afff16d5ed8fb5645681aee7",
  },
  "tree-sitter-haskell/tree-sitter-haskell.wasm": {
    version: "0.23.1",
    sha256: "37a6b07b1a838d02ffb4f4c2a06863637a8efe48432d60a275f50f1d08f1092c",
  },
  "tree-sitter-html/tree-sitter-html.wasm": {
    version: "0.23.2",
    sha256: "c48fcd82c7ea8bf943180088ba7f28c48b2bb5287874179168bf9d31e394cf85",
  },
  "tree-sitter-java/tree-sitter-java.wasm": {
    version: "0.23.5",
    sha256: "4fdeac4ca6ca089f06c6f7e562abcac1733cd465728cc7031ebb73c2019122c4",
  },
  "tree-sitter-javascript/tree-sitter-javascript.wasm": {
    version: "0.25.0",
    sha256: "5fb488d0cabb4775a594bab85682de5ad6ce83c0d6ac997a9f82dd084d571240",
  },
  "tree-sitter-json/tree-sitter-json.wasm": {
    version: "0.24.8",
    sha256: "d2119fb98d5912719b13f9458574f8608d2d29dfbe45f6be1f860ea1fe2a2405",
  },
  "tree-sitter-php/tree-sitter-php.wasm": {
    version: "0.24.2",
    sha256: "d4df6a6ff08c87c3ec4f9cbb785fe09998a0cb570e03f57d7b19b3acfb146aa7",
  },
  "tree-sitter-python/tree-sitter-python.wasm": {
    version: "0.25.0",
    sha256: "16108b50df4ee9a30168794252ab55e7c93bfc5765d7fa0aa3e335752c515f47",
  },
  "tree-sitter-ruby/tree-sitter-ruby.wasm": {
    version: "0.23.1",
    sha256: "09a96427d7c72f0613ed470cd9812223fc4a91d6a9c025c0235cc6bd59ff96f4",
  },
  "tree-sitter-rust/tree-sitter-rust.wasm": {
    version: "0.24.0",
    sha256: "f65f354215611fd94ad34134b3427eb3d58cbb745df7b6509ba722184db73d57",
  },
  "tree-sitter-scala/tree-sitter-scala.wasm": {
    version: "0.24.0",
    sha256: "b7ec2bb29c19827abcefd18ed5cb5a43596009f96a5d53c5b9d1f9676d7521c3",
  },
  "tree-sitter-typescript/tree-sitter-tsx.wasm": {
    version: "0.23.2",
    sha256: "79e5da75ea62855a0cd67177685f0164eac87d5f630b3cbe1e0a099751ad30f8",
  },
  "tree-sitter-typescript/tree-sitter-typescript.wasm": {
    version: "0.23.2",
    sha256: "778025db5a8be0e70f8ccc3671e486dfeddd048c25d9e8a70c26de2e1bf6f97d",
  },
  "tree-sitter-wasms/out/tree-sitter-lua.wasm": {
    version: "0.1.13",
    sha256: "75ef809136d610068c5b2135741d89f5df62690a3d55169203351cb7cc85727d",
  },
  "tree-sitter-wasms/out/tree-sitter-swift.wasm": {
    version: "0.1.13",
    sha256: "41c4fdb2249a3aa6d87eed0d383081ff09725c2248b4977043a43825980ffcc7",
  },
  "tree-sitter-wasms/out/tree-sitter-toml.wasm": {
    version: "0.1.13",
    sha256: "7849ac8ce9d10a4684ca189ea8ad3654c20c38acb2d674a014a164398cbd37a2",
  },
  "tree-sitter-wasms/out/tree-sitter-vue.wasm": {
    version: "0.1.13",
    sha256: "6244521bb3fb60f34ce5f677f2af81facb2c38691193985ca5fa85e1b6f29250",
  },
  "tree-sitter-wasms/out/tree-sitter-yaml.wasm": {
    version: "0.1.13",
    sha256: "5dea7cfff83d41d8f87fb8e434e1a5b292c0d670bfcdc42cb2af420ef490dde5",
  },
};

const grammarCache = new Map<string, Promise<Language | null>>();
let parserInit: Promise<void> | null = null;

const MAX_FETCH_RETRIES = 3;
const FETCH_TIMEOUT_MS = 30_000;

function artifactFor(entry: GrammarEntry): GrammarArtifact {
  const key = `${entry.pkg}/${entry.wasm}`;
  const artifact = GRAMMAR_ARTIFACTS[key];
  if (artifact === undefined) throw new Error(`No pinned grammar artifact configured for ${key}`);
  return artifact;
}

for (const entry of Object.values(LANGUAGE_MAP)) artifactFor(entry);

function waitForSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise;
  signal.throwIfAborted();

  return new Promise<T>((resolvePromise, rejectPromise) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      rejectPromise(signal.reason ?? new Error("Operation aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolvePromise(value);
      },
      (error: unknown) => {
        cleanup();
        rejectPromise(error);
      },
    );
    if (signal.aborted) onAbort();
  });
}

/** Ensure the web-tree-sitter WASM runtime is initialized once per process. */
export async function ensureParser(signal?: AbortSignal): Promise<void> {
  if (parserInit === null) {
    parserInit = Parser.init().catch((error: unknown) => {
      parserInit = null;
      throw error;
    });
  }
  await waitForSignal(parserInit, signal);
}

function hasExpectedIntegrity(bytes: Uint8Array, artifact: GrammarArtifact): boolean {
  return createHash("sha256").update(bytes).digest("hex") === artifact.sha256;
}

async function fetchWithRetry(url: string): Promise<Uint8Array> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_FETCH_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_FETCH_RETRIES) {
        await new Promise((resolvePromise) =>
          setTimeout(resolvePromise, 1000 * 2 ** (attempt - 1)),
        );
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError ?? new Error("Grammar download failed");
}

async function writeCacheAtomically(cachePath: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(cachePath), { recursive: true });
  const temporaryPath = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, bytes, { mode: 0o600 });
    await rename(temporaryPath, cachePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function loadGrammarUncached(
  entry: GrammarEntry,
  artifact: GrammarArtifact,
  notify?: NotifyFn,
): Promise<Language | null> {
  const versionedPackage = `${entry.pkg}@${artifact.version}`;
  const versionedKey = `${versionedPackage}/${entry.wasm}`;
  const cachePath = resolve(CACHE_DIR, versionedPackage, entry.wasm);

  const cachedBytes = await readFile(cachePath)
    .then((bytes) => new Uint8Array(bytes))
    .catch(() => null);
  if (cachedBytes !== null) {
    if (hasExpectedIntegrity(cachedBytes, artifact)) {
      const language = await Language.load(cachedBytes).catch(() => null);
      if (language !== null) return language;
    }
    await rm(cachePath, { force: true }).catch(() => undefined);
  }

  try {
    const bytes = await fetchWithRetry(`${WASM_CDN}/${versionedKey}`);
    if (!hasExpectedIntegrity(bytes, artifact)) {
      throw new Error(`Integrity check failed for ${versionedKey}`);
    }
    const language = await Language.load(bytes);
    // A read-only or full cache must not disable an otherwise valid grammar.
    await writeCacheAtomically(cachePath, bytes).catch(() => undefined);
    notify?.(`Tree-sitter grammar for ${formatGrammarName(entry)} ready`, "info");
    return language;
  } catch {
    notify?.(`Failed to load tree-sitter grammar for ${formatGrammarName(entry)}`, "error");
    return null;
  }
}

/** Load a pinned, integrity-checked grammar with shared in-flight work. */
export function loadGrammar(
  entry: GrammarEntry,
  notify?: NotifyFn,
  signal?: AbortSignal,
): Promise<Language | null> {
  const artifact = artifactFor(entry);
  const key = `${entry.pkg}@${artifact.version}/${entry.wasm}`;
  let loading = grammarCache.get(key);
  if (loading === undefined) {
    loading = loadGrammarUncached(entry, artifact, notify).then(
      (language) => {
        if (language === null) grammarCache.delete(key);
        return language;
      },
      (error: unknown) => {
        grammarCache.delete(key);
        throw error;
      },
    );
    grammarCache.set(key, loading);
  }
  return waitForSignal(loading, signal);
}

/** Get a grammar for a file extension, or null if unknown. */
export async function getLanguage(ext: string, signal?: AbortSignal): Promise<Language | null> {
  const entry = LANGUAGE_MAP[ext.toLowerCase()];
  if (!entry) return null;
  await ensureParser(signal);
  return loadGrammar(entry, undefined, signal);
}
