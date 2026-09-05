/**
 * pi-tree-sitter — Pre-write syntax validation + structural code tools for pi
 *
 * Hooks `write` and `edit` tools to validate syntax (blocks on errors).
 * Registers semantic tools for AST-level code queries:
 *   - list_symbols      — symbols in a file or project
 *   - find_definition   — where a symbol is defined
 *   - find_callers      — call sites of a function/method
 *   - get_symbol_body   — full source of a named symbol
 *
 * Inspired by dirge's syntax_validator.rs and semantic adapters.
 * Adapted from pi-tree-sitter 0.2.8 by Marko Kocic under EPL-2.0.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type {
  AgentToolResult,
  ExtensionAPI,
  ToolDefinition,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  getLanguageFromPath,
  highlightCode,
  isToolCallEventType,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { Tree, Node as TSNode } from "web-tree-sitter";
import { BALANCE_RULES, checkDelimiterBalance } from "./src/delimiter.js";
import {
  describePrefixLeftover,
  findPrefixLeftover,
  simulateEditContent,
} from "./src/edit-guard.js";
import { findProjectFiles, type ProjectFileSearch, readFileSafe } from "./src/files.js";
import { ensureParser, LANGUAGE_MAP, loadGrammar, type NotifyFn } from "./src/grammar.js";
import type { ExtractedFile, Symbol as Sym } from "./src/languages.js";
import { configForFile } from "./src/languages.js";
import { withParseTree } from "./src/parse-tree.js";

// ── Error collection (write-time validation) ─────────────────────────────

const MAX_ERRORS = 10;

type ToolRenderCall = NonNullable<ToolDefinition["renderCall"]>;
type ToolRenderTheme = Parameters<ToolRenderCall>[1];
type LastComponentContext = Pick<Parameters<ToolRenderCall>[2], "lastComponent">;

interface SymbolRenderInput {
  readonly kind?: string;
  readonly name?: string;
  readonly path?: string;
}

interface SymbolToolDetails {
  readonly count?: number;
  readonly fileCount?: number;
  readonly label?: string;
  readonly name?: string;
}

interface SymbolBodyDetails {
  readonly body?: string;
  readonly fullBodyPath?: string;
  readonly language?: string;
  readonly lineCount?: number;
  readonly name?: string;
  readonly path?: string;
}

function resolveToolPath(cwd: string, path: string): string {
  return resolve(cwd, path.startsWith("@") ? path.slice(1) : path);
}

function toolResultText(result: AgentToolResult<unknown>): string {
  return result.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n");
}

function outputTruncation(text: string) {
  return truncateHead(text, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });
}

interface BoundedResult {
  readonly fullPath?: string;
  readonly text: string;
}

async function boundedResult(
  text: string,
  persistedText = text,
  fullOutputLabel = "Full output",
): Promise<BoundedResult> {
  const truncation = outputTruncation(text);
  if (!truncation.truncated) return { text };

  const fullPath = resolve(tmpdir(), `pi-tree-sitter-${randomUUID()}.txt`);
  await writeFile(fullPath, persistedText, { encoding: "utf8", mode: 0o600 });
  return {
    fullPath,
    text: `${truncation.content}\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ${fullOutputLabel} saved to: ${fullPath}]`,
  };
}

async function boundedOutput(text: string): Promise<string> {
  return (await boundedResult(text)).text;
}

function boundedPreview(text: string): string {
  const truncation = outputTruncation(text);
  return truncation.truncated ? `${truncation.content}\n…` : text;
}

function searchLimitNotice(search: Pick<ProjectFileSearch, "limit" | "truncated">): string {
  return search.truncated
    ? `\n\n[Search stopped after ${search.limit} source files. Pass a narrower path to search the remaining files.]`
    : "";
}

/** Return the line content that contains `offset`, for context. */
function lineAt(source: string, offset: number): string {
  const start = source.lastIndexOf("\n", offset - 1) + 1;
  const end = source.indexOf("\n", offset);
  return source.slice(start, end === -1 ? source.length : end);
}

/** Names for anonymous closing-token types that clarify the issue. */
const CLOSER_LABELS: Record<string, string> = {
  ")": "parenthesis",
  "]": "bracket",
  "}": "brace",
};

/** Produce a human-readable, context-rich error for one tree-sitter node. */
function formatError(node: TSNode, source: string): string {
  const line = node.startPosition.row + 1;
  const col = node.startPosition.column + 1;
  const raw = source.slice(node.startIndex, Math.min(node.endIndex, source.length));
  const snippet = (raw.split("\n")[0] ?? "").slice(0, 80).trimEnd();

  if (node.isMissing) {
    const label = CLOSER_LABELS[node.type];
    if (label) {
      return `Missing \`${node.type}\` — unclosed ${label} at line ${line}:${col}`;
    }
    return `Missing \`${node.type}\` at line ${line}:${col}`;
  }

  // Error node (unexpected token)
  const label = CLOSER_LABELS[snippet];
  if (label) {
    return `Unexpected \`${snippet}\` — extra closing ${label} at line ${line}:${col}`;
  }
  return `Unexpected \`${snippet}\` at line ${line}:${col}`;
}

function collectErrors(tree: Tree, source: string): string[] {
  const errors: string[] = [];
  const stack: TSNode[] = [tree.rootNode];

  while (stack.length > 0 && errors.length < MAX_ERRORS) {
    const node = stack.pop();
    if (node === undefined) break;
    if (node.isError || node.isMissing) {
      // ERROR nodes can span a large region with more specific
      // error/missing children inside.  Descend to find the narrowest
      // error — the child will have a better position and snippet.
      if (node.isError && !node.isMissing) {
        let hasSpecificChild = false;
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child?.isError || child?.isMissing) {
            hasSpecificChild = true;
            break;
          }
        }
        if (hasSpecificChild) {
          for (let i = node.childCount - 1; i >= 0; i--) {
            const child = node.child(i);
            if (child !== null) stack.push(child);
          }
          continue;
        }
      }
      const msg = formatError(node, source);
      const offset = node.startIndex;
      const ctxLine = lineAt(source, offset);
      const lineStart = source.lastIndexOf("\n", offset) + 1;
      const col = offset - lineStart;
      const pointer = " ".repeat(Math.max(0, col)) + "^";
      const lineNum = node.startPosition.row + 1;
      errors.push("  " + msg + "\n    |\n    " + lineNum + " | " + ctxLine + "\n    | " + pointer);
      continue;
    }
    const children = node.children;
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child !== undefined) stack.push(child);
    }
  }
  return errors;
}

/**
 * Validate content for write/edit blocking. Returns null = clean.
 *
 * For Lisp-like languages (Clojure, Scheme, Elisp, etc.) the delimiter
 * balance scanner serves as a second-opinion sanity check: tree-sitter
 * grammars can produce false positives on valid code (e.g. Java interop
 * like `(StringBuilder.)`), but a file with correct delimiter balance
 * is structurally sound.  When both checks are available, we only block
 * if both agree there's a problem — this prevents false positives while
 * still catching unbalanced delimiters.
 */
async function validateContent(
  path: string,
  content: string,
  notify?: NotifyFn,
  signal?: AbortSignal,
): Promise<string | null> {
  const ext = path.match(/\.[^.]+$/)?.[0]?.toLowerCase();
  if (!ext) return null;

  const rules = ext ? BALANCE_RULES[ext] : undefined;

  const entry = LANGUAGE_MAP[ext];
  if (entry) {
    await ensureParser(signal);
    const lang = await loadGrammar(entry, notify, signal);
    if (lang) {
      const errors = withParseTree(content, lang, (tree) =>
        tree.rootNode.hasError ? collectErrors(tree, content) : [],
      );
      if (errors.length > 0) {
        // Grammar reports errors — run delimiter balance as second opinion
        if (rules) {
          const balanceErr = checkDelimiterBalance(path, content, rules);
          if (balanceErr === null) {
            // Delimiters are balanced — grammar likely producing a false
            // positive (e.g. Java interop in Clojure). Warn but don't block.
            return null;
          }
          // Both grammar and delimiter check agree — block with combined message
          let msg =
            "Syntax check failed for " +
            path +
            ": " +
            errors.length +
            " error(s) detected by tree-sitter.\n";
          msg += "Delimiter balance also reports issues:\n  " + balanceErr + "\n";
          msg +=
            "Fix and re-submit. (This is a pre-write guard \u2014 the file was NOT modified.)\n";
          msg += errors.join("\n");
          if (errors.length >= MAX_ERRORS) {
            msg +=
              "\n  \u2026(truncated at " +
              MAX_ERRORS +
              " errors; fix the listed issues and re-check)";
          }
          return msg;
        }
        // No delimiter rules for this extension — trust the grammar
        let msg =
          "Syntax check failed for " +
          path +
          ": " +
          errors.length +
          " error(s) detected by tree-sitter.\n";
        msg += "Fix and re-submit. (This is a pre-write guard \u2014 the file was NOT modified.)\n";
        msg += errors.join("\n");
        if (errors.length >= MAX_ERRORS) {
          msg +=
            "\n  \u2026(truncated at " +
            MAX_ERRORS +
            " errors; fix the listed issues and re-check)";
        }
        return msg;
      }
      // Grammar loaded but file has no errors — clean
      return null;
    }
    return `Cannot modify ${path}: syntax validation is unavailable because its tree-sitter grammar could not be loaded. The file was NOT modified.`;
  }

  if (rules) {
    const err = checkDelimiterBalance(path, content, rules);
    if (err) {
      return (
        "Syntax check failed for " +
        path +
        ": delimiters are unbalanced.\nFix and re-submit. (This is a pre-write guard \u2014 the file was NOT modified.)\n  " +
        err
      );
    }
  }
  return null;
}

// ── Semantic tool helpers ────────────────────────────────────────────────

function formatSymbol(sym: Sym): string {
  const classHint = sym.parentClass ? " [class: " + sym.parentClass + "]" : "";
  const exportMark = sym.isExported ? " (exported)" : "";
  return (
    "  " +
    sym.range.startLine +
    "-" +
    sym.range.endLine +
    " [" +
    sym.kind +
    "] " +
    sym.name +
    classHint +
    exportMark
  );
}

function formatResults(results: Map<string, Sym[]>): string {
  let total = 0;
  const parts: string[] = [];
  for (const [path, syms] of results) {
    parts.push("## " + path);
    for (const sym of syms) {
      parts.push(formatSymbol(sym));
    }
    total += syms.length;
  }
  parts.push("\n" + total + " symbols across " + results.size + " files");
  return parts.join("\n");
}

async function extractFile(
  filePath: string,
  notify?: NotifyFn,
  signal?: AbortSignal,
): Promise<ExtractedFile | null> {
  signal?.throwIfAborted();
  const ext = filePath.match(/\.[^.]+$/)?.[0]?.toLowerCase();
  if (!ext) return null;
  const source = await readFileSafe(filePath, signal);
  if (source === null) return null;
  const config = configForFile(filePath, source);
  if (!config) return null;
  const grammarExt = config.extensions[0];
  if (grammarExt === undefined) return null;
  const entry = LANGUAGE_MAP[grammarExt];
  if (!entry) return null;
  await ensureParser(signal);
  const lang = await loadGrammar(entry, notify, signal);
  if (!lang) throw new Error(`Cannot inspect ${filePath}: tree-sitter grammar is unavailable.`);
  signal?.throwIfAborted();
  const extracted = config.extract(source, lang);
  signal?.throwIfAborted();
  return extracted;
}

interface ExtractedSearch extends ProjectFileSearch {
  readonly results: Map<string, Sym[]>;
}

async function extractAllFiles(
  dir: string,
  notify?: NotifyFn,
  signal?: AbortSignal,
): Promise<ExtractedSearch> {
  const results = new Map<string, Sym[]>();
  const search = await findProjectFiles(dir, signal ? { signal } : {});
  for (const file of search.files) {
    signal?.throwIfAborted();
    const extracted = await extractFile(file, notify, signal);
    if (extracted && extracted.symbols.length > 0) results.set(file, extracted.symbols);
  }
  return { ...search, results };
}

// ── Shared renderCall (generic for all symbol tools) ─────────────────────

function renderSymbolCall(toolName: string) {
  return (args: SymbolRenderInput, theme: ToolRenderTheme, context: LastComponentContext): Text => {
    const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
    let content = theme.fg("toolTitle", theme.bold(toolName));
    if (args.name) content += ` — ${theme.fg("accent", args.name)}`;
    if (args.path) content += `  ${theme.fg("muted", `in ${args.path}`)}`;
    if (args.kind) content += `  [${theme.fg("dim", `kind: ${args.kind}`)}]`;
    text.setText(content);
    return text;
  };
}

// ── Shared renderResult (generic for all symbol tools) ────────────────────

function renderSymbolResult() {
  return (
    result: AgentToolResult<SymbolToolDetails>,
    { expanded }: ToolRenderResultOptions,
    theme: ToolRenderTheme,
  ): Text => {
    const output = toolResultText(result);
    const { count, label, name, fileCount } = result.details ?? {};
    if (count === undefined || label === undefined || expanded) return new Text(output, 0, 0);

    if (count === 0) {
      return new Text(
        theme.fg("dim", `No ${label} found`) + (name ? theme.fg("accent", ` for '${name}'`) : ""),
        0,
        0,
      );
    }
    let text = `${theme.fg("success", "✓ ")}${count} ${label}`;
    if (name) text += theme.fg("accent", ` for '${name}'`);
    if (fileCount) {
      text += theme.fg("dim", ` across ${fileCount} file${fileCount === 1 ? "" : "s"}`);
    }
    return new Text(text, 0, 0);
  };
}

// ── Entry point ──────────────────────────────────────────────────────────

export default async function (pi: ExtensionAPI) {
  // ── Write/Edit validation (existing behavior) ────────────────────────
  pi.on("tool_call", async (event, ctx) => {
    const notify = ctx.ui.notify.bind(ctx.ui);
    if (isToolCallEventType("write", event)) {
      const input = event.input;
      const err = await validateContent(input.path, input.content, notify);
      if (err) return { block: true, reason: err };
      return;
    }

    if (isToolCallEventType("edit", event)) {
      const input = event.input;
      if (!input.edits || input.edits.length === 0) return;
      const absolutePath = resolveToolPath(ctx.cwd, input.path);
      try {
        const rawContent = await readFile(absolutePath, "utf-8");
        // Run the edit tool's own execute with file operations redirected to
        // memory: we validate exactly the content the tool would write.
        const proposed = await simulateEditContent(
          rawContent,
          input.path,
          input.edits,
          ctx.cwd,
          ctx,
        );
        // The tool itself would fail the call with a precise error (text not
        // found, non-unique, overlapping, empty oldText, no change) — stay
        // silent and let the tool report it.
        if (proposed === null) return;
        const err = await validateContent(input.path, proposed, notify);
        if (err) {
          // If an oldText matched only a prefix of a line, the leftover
          // characters after the replacement are the likely cause of the
          // syntax error — say so instead of only showing the symptom.
          const leftover = findPrefixLeftover(rawContent, input.edits);
          const cause = leftover ? describePrefixLeftover(leftover) + "\n\n" : "";
          return { block: true, reason: cause + err };
        }
        // shortcut: tool-call hooks cannot hold Pi's mutation queue through the
        // later edit execution. Native oldText matching catches most stale
        // snapshots; replace this hook if Pi adds atomic execution middleware.
      } catch (error) {
        // Let the edit tool report ordinary filesystem failures itself, but do
        // not silently disable validation after an unexpected simulation bug.
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          typeof error.code === "string"
        ) {
          return;
        }
        throw error;
      }
    }
  });

  // ── list_symbols ─────────────────────────────────────────────────────
  pi.registerTool({
    name: "list_symbols",
    label: "List Symbols",
    description:
      "List symbols (functions, classes, methods, etc.) in a file or across the project. Parses code with tree-sitter for accurate results. Use this instead of grep when looking for code structure.",
    promptSnippet: "List symbols (functions, classes, methods, etc.) in files",
    promptGuidelines: [
      "Use list_symbols when you need to find all symbols (functions, classes, methods, etc.) in a file or across the project. Prefer this over grep for code structure queries.",
    ],
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({
          description: "File path to list symbols from. Omit to list across all project files.",
        }),
      ),
      kind: Type.Optional(
        Type.String({
          description: "Filter by symbol kind: function, class, method, interface, type, variable",
        }),
      ),
    }),
    renderCall: renderSymbolCall("list_symbols"),
    renderResult: renderSymbolResult(),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      const filterKind = params.kind?.toLowerCase();
      const notify = ctx.ui.notify.bind(ctx.ui);
      let search: ExtractedSearch;
      if (params.path) {
        const filePath = resolveToolPath(ctx.cwd, params.path);
        const extracted = await extractFile(filePath, notify, signal);
        const results = new Map<string, Sym[]>();
        if (extracted) results.set(filePath, extracted.symbols);
        search = { files: [filePath], limit: 1, truncated: false, results };
      } else {
        search = await extractAllFiles(ctx.cwd, notify, signal);
      }
      const { results } = search;
      if (results.size === 0) {
        return {
          content: [{ type: "text", text: `No symbols found.${searchLimitNotice(search)}` }],
          details: { count: 0, label: "symbols" },
        };
      }
      if (filterKind) {
        for (const [path, syms] of results) {
          const filtered = syms.filter((symbol) => symbol.kind === filterKind);
          if (filtered.length > 0) results.set(path, filtered);
          else results.delete(path);
        }
      }
      let total = 0;
      for (const symbols of results.values()) total += symbols.length;
      const output = `${formatResults(results)}${searchLimitNotice(search)}`;
      return {
        content: [{ type: "text", text: await boundedOutput(output) }],
        details: { count: total, label: "symbols", fileCount: results.size },
      };
    },
  });

  // ── find_definition ──────────────────────────────────────────────────
  pi.registerTool({
    name: "find_definition",
    label: "Find Definition",
    description:
      "Find where a SYMBOL (function, class, type, etc.) is DEFINED across the project. Uses tree-sitter for precise structural matching. NOT for finding files by name \u2014 use `find_files` for that. NOT for content search \u2014 use `grep`.",
    promptSnippet: "Find where a symbol is defined across the project",
    promptGuidelines: [
      "Use find_definition when you need to find where a symbol is defined. This is more precise than grep because it uses AST matching.",
    ],
    parameters: Type.Object({
      name: Type.String({ description: "Name of the symbol to find" }),
    }),
    renderCall: renderSymbolCall("find_definition"),
    renderResult: renderSymbolResult(),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const search = await extractAllFiles(ctx.cwd, ctx.ui.notify.bind(ctx.ui), signal);
      interface Hit {
        path: string;
        sym: Sym;
      }
      const hits: Hit[] = [];
      for (const [path, symbols] of search.results) {
        signal?.throwIfAborted();
        for (const symbol of symbols) {
          if (symbol.name === params.name) hits.push({ path, sym: symbol });
        }
      }
      const limitNotice = searchLimitNotice(search);
      if (hits.length === 0) {
        return {
          content: [
            { type: "text", text: `No definition found for '${params.name}'.${limitNotice}` },
          ],
          details: { count: 0, label: "definitions", name: params.name },
        };
      }
      const lines: string[] = [`Found ${hits.length} definition(s) for '${params.name}':`];
      for (const { path, sym } of hits) {
        lines.push(`  ${path}:${sym.range.startLine} [${sym.kind}] ${sym.signature}`);
      }
      return {
        content: [{ type: "text", text: await boundedOutput(`${lines.join("\n")}${limitNotice}`) }],
        details: { count: hits.length, label: "definitions", name: params.name },
      };
    },
  });

  // ── find_callers ─────────────────────────────────────────────────────
  pi.registerTool({
    name: "find_callers",
    label: "Find Callers",
    description:
      "Find call sites of a function or method across the project, including module-level and recursive calls. Returns call-site lines, not declaration lines. Uses tree-sitter AST queries, not substring matching. Lua accepts exact qualified names (M.target, object:method) or bare member names.",
    promptSnippet: "Find all call sites of a function or method across the project",
    promptGuidelines: [
      "Use find_callers to find all places that call a specific function or method. This is more precise than grep because it uses AST queries and excludes false positives from comments/strings.",
    ],
    parameters: Type.Object({
      name: Type.String({ description: "Name of the function/method to find callers of" }),
      path: Type.Optional(
        Type.String({
          description: "Directory to search in (defaults to current working directory)",
        }),
      ),
    }),
    renderCall: renderSymbolCall("find_callers"),
    renderResult: renderSymbolResult(),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      const notify = ctx.ui.notify.bind(ctx.ui);
      const searchPath = params.path ? resolveToolPath(ctx.cwd, params.path) : ctx.cwd;
      const callers: string[] = [];

      const search = await findProjectFiles(searchPath, signal ? { signal } : {});
      for (const file of search.files) {
        signal?.throwIfAborted();
        const config = configForFile(file);
        if (!config) continue;
        const grammarExt = config.extensions[0];
        if (grammarExt === undefined) continue;
        const entry = LANGUAGE_MAP[grammarExt];
        if (!entry) continue;
        await ensureParser(signal);
        const lang = await loadGrammar(entry, notify, signal);
        if (!lang) throw new Error(`Cannot inspect ${file}: tree-sitter grammar is unavailable.`);
        const source = await readFileSafe(file, signal);
        if (source === null) continue;

        signal?.throwIfAborted();
        // Query the whole file once so calls need not belong to an extracted declaration.
        const callees = config.findCallees(source, lang, {
          startByte: 0,
          endByte: source.length,
          startLine: 1,
          endLine: source.split("\n").length,
        });
        const matchLuaMembers = config.extensions.includes(".lua") && !/[.:]/.test(params.name);
        for (const callee of callees) {
          const memberMatches =
            matchLuaMembers && callee.name.split(/[.:]/).at(-1)?.trim() === params.name;
          if (callee.name === params.name || memberMatches) {
            callers.push(`  ${file}:${callee.line} ${callee.name}`);
          }
        }
      }

      const limitNotice = searchLimitNotice(search);
      if (callers.length === 0) {
        return {
          content: [{ type: "text", text: `No callers found for '${params.name}'.${limitNotice}` }],
          details: { count: 0, label: "call sites", name: params.name },
        };
      }
      return {
        content: [
          {
            type: "text",
            text: await boundedOutput(
              `${callers.length} call site(s) for '${params.name}':\n${callers.join("\n")}${limitNotice}`,
            ),
          },
        ],
        details: { count: callers.length, label: "call sites", name: params.name },
      };
    },
  });

  // ── get_symbol_body ──────────────────────────────────────────────────
  const getSymbolBodyParameters = Type.Object({
    path: Type.String({ description: "Path to the file containing the symbol" }),
    name: Type.String({ description: "Name of the symbol to retrieve" }),
  });
  pi.registerTool<typeof getSymbolBodyParameters, SymbolBodyDetails>({
    name: "get_symbol_body",
    label: "Get Symbol Body",
    description:
      "Get the full source code of a named symbol (function, class, method, etc.) from a file. Uses tree-sitter to precisely extract by source range.",
    promptSnippet: "Get the full source code of a named symbol from a file",
    promptGuidelines: [
      "Use get_symbol_body to extract the full source code of a named symbol by its AST source range, which is more accurate than slicing by line numbers.",
    ],
    parameters: getSymbolBodyParameters,
    renderCall: renderSymbolCall("get_symbol_body"),
    renderResult(result, { expanded }, theme, context) {
      const details = result.details;
      if (
        context.isError ||
        details?.body === undefined ||
        details.name === undefined ||
        details.path === undefined ||
        details.lineCount === undefined
      ) {
        return new Text(theme.fg("error", toolResultText(result) || "Error"), 0, 0);
      }
      if (expanded) {
        let body = details.body;
        if (details.fullBodyPath !== undefined) {
          try {
            body = readFileSync(details.fullBodyPath, "utf8");
          } catch {
            body += "\n\n[Full symbol body is no longer available.]";
          }
        }
        return new Text(highlightCode(body, details.language).join("\n"), 0, 0);
      }
      return new Text(
        theme.fg("success", "✓ ") +
          theme.fg("accent", details.name) +
          theme.fg("dim", ` (${details.lineCount} lines) in `) +
          theme.fg("muted", details.path),
        0,
        0,
      );
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      const filePath = resolveToolPath(ctx.cwd, params.path);
      const extracted = await extractFile(filePath, ctx.ui.notify.bind(ctx.ui), signal);
      if (!extracted) {
        return { content: [{ type: "text", text: `Could not parse ${filePath}` }], details: {} };
      }
      for (const symbol of extracted.symbols) {
        signal?.throwIfAborted();
        if (symbol.name === params.name) {
          const source = await readFileSafe(filePath, signal);
          if (source === null) {
            return { content: [{ type: "text", text: `Could not read ${filePath}` }], details: {} };
          }
          const body = source.slice(symbol.range.startByte, symbol.range.endByte);
          const lineCount = body.split("\n").length;
          const language = getLanguageFromPath(filePath);
          const output = await boundedResult(
            `Symbol: ${params.name} in ${filePath}\n\n${body}`,
            body,
            "Full symbol body",
          );
          return {
            content: [{ type: "text", text: output.text }],
            details: {
              body: boundedPreview(body),
              name: params.name,
              path: filePath,
              lineCount,
              ...(output.fullPath === undefined ? {} : { fullBodyPath: output.fullPath }),
              ...(language === undefined ? {} : { language }),
            },
          };
        }
      }
      return {
        content: [{ type: "text", text: `Symbol '${params.name}' not found in ${filePath}` }],
        details: {},
      };
    },
  });

  // ── find_callees ─────────────────────────────────────────────────────
  pi.registerTool({
    name: "find_callees",
    label: "Find Callees",
    description:
      "Find all functions/methods called by a given symbol (its callees). Uses tree-sitter to extract call expressions from the symbol body. Supports all tree-sitter supported languages.",
    promptSnippet: "Find all functions or methods called by a given symbol",
    promptGuidelines: [
      "Use find_callees to find all functions called by a given function or method. Uses tree-sitter AST queries for accuracy.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Path to the file containing the symbol" }),
      name: Type.String({ description: "Name of the function/method to analyze" }),
    }),
    renderCall: renderSymbolCall("find_callees"),
    renderResult: renderSymbolResult(),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      const noCallees = () => ({
        content: [{ type: "text" as const, text: `No callees found for '${params.name}'` }],
        details: { count: 0, label: "callees", name: params.name },
      });
      const notify = ctx.ui.notify.bind(ctx.ui);
      const filePath = resolveToolPath(ctx.cwd, params.path);
      const config = configForFile(filePath);
      if (!config) return noCallees();
      const grammarExt = config.extensions[0];
      const entry = grammarExt === undefined ? undefined : LANGUAGE_MAP[grammarExt];
      if (!entry) return noCallees();
      await ensureParser(signal);
      const lang = await loadGrammar(entry, notify, signal);
      if (!lang) throw new Error(`Cannot inspect ${filePath}: tree-sitter grammar is unavailable.`);
      const source = await readFileSafe(filePath, signal);
      if (source === null) return noCallees();

      signal?.throwIfAborted();
      const extracted = config.extract(source, lang);
      signal?.throwIfAborted();
      for (const symbol of extracted.symbols) {
        if (symbol.name === params.name) {
          const callees = config.findCallees(source, lang, symbol.range);
          if (callees.length === 0) return noCallees();
          const lines = callees.map((callee) => `  ${callee.line}  ${callee.name}`);
          return {
            content: [
              {
                type: "text",
                text: await boundedOutput(
                  `Callees of ${params.name} in ${filePath}:\n${lines.join("\n")}`,
                ),
              },
            ],
            details: { count: callees.length, label: "callees", name: params.name },
          };
        }
      }
      return {
        content: [{ type: "text", text: `Symbol '${params.name}' not found in ${filePath}` }],
        details: {},
      };
    },
  });
}
