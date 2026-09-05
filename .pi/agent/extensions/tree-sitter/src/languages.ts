/**
 * Per-language tree-sitter configs for symbol extraction and callee queries.
 * Each entry handles one or more file extensions.
 *
 * Uses tree-sitter S-expression queries for top-level declarations and
 * node-tree walking for structured navigation (class bodies, export detection).
 *
 * No adapter interface, no registry — just a flat array + lookup.
 */

import { readFileSync } from "node:fs";
import { type Language, type Node, Query } from "web-tree-sitter";
import { withParseTree } from "./parse-tree.js";

// ── Types ────────────────────────────────────────────────────────────────

export type SymbolKind = "function" | "class" | "method" | "interface" | "type" | "variable";

export interface ByteRange {
  startByte: number;
  endByte: number;
  startLine: number;
  endLine: number;
}

export interface Symbol {
  kind: SymbolKind;
  name: string;
  range: ByteRange;
  signature: string;
  isExported: boolean;
  parentClass: string | null;
}

export interface ExtractedFile {
  symbols: Symbol[];
  imports: Import[];
  exports: string[];
  warnings: string[];
}

export type ImportKind = "header" | "module" | "qualified";

export interface Import {
  names: string[];
  source: string;
  kind: ImportKind;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function nodeText(node: Node, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}

function nodeRange(node: Node): ByteRange {
  return {
    startByte: node.startIndex,
    endByte: node.endIndex,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
  };
}

function sig(node: Node, source: string): string {
  const body = node.childForFieldName("body");
  const end = body ? body.startIndex : node.endIndex;
  return source.slice(node.startIndex, end).trim();
}

function extractWithTree(
  extract: (source: string, root: Node) => ExtractedFile,
): LangConfig["extract"] {
  return (source, language) =>
    withParseTree(source, language, (tree) => extract(source, tree.rootNode));
}

/** Strip C/C++ comments and string literals for .h sniffing. */
function stripCComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/\/\/.*/g, " ") // line comments
    .replace(/"(?:[^"\\]|\\.)*"/g, " ") // double-quoted strings
    .replace(/'(?:[^'\\]|\\.)*'/g, " "); // char literals
}

function readFileSafe(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

/** Run a tree-sitter query and return named node captures. */
function queryCaptures(
  source: string,
  lang: Language,
  querySource: string,
  captureName: string,
  range?: ByteRange,
): Array<{ name: string; line: number }> {
  try {
    const query = new Query(lang, querySource);
    try {
      return withParseTree(source, lang, (tree) => {
        const matches = query.matches(tree.rootNode, {});
        const result: Array<{ name: string; line: number }> = [];
        for (const m of matches) {
          for (const c of m.captures) {
            if (c.name === captureName) {
              if (
                !range ||
                (c.node.startIndex >= range.startByte && c.node.startIndex <= range.endByte)
              ) {
                result.push({ name: nodeText(c.node, source), line: c.node.startPosition.row + 1 });
              }
            }
          }
        }
        return result;
      });
    } finally {
      query.delete();
    }
  } catch {
    return [];
  }
}

// ── Language config ──────────────────────────────────────────────────────

export interface LangConfig {
  extensions: string[];
  /** Extract symbols from source. */
  extract: (source: string, lang: Language) => ExtractedFile;
  /** Find callee names within a byte range. */
  findCallees: (
    source: string,
    lang: Language,
    range: ByteRange,
  ) => Array<{ name: string; line: number }>;
}

// ── TypeScript / JavaScript ──────────────────────────────────────────────

const tsExtract = (source: string, root: Node): ExtractedFile => {
  const symbols: Symbol[] = [];
  const warnings: string[] = [];
  if (root.hasError) warnings.push("tree-sitter reported syntax errors");

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i);
    if (!child) continue;

    switch (child.type) {
      case "function_declaration": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "function",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: isTsExported(child),
            parentClass: null,
          });
        break;
      }
      case "class_declaration": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        const name = nodeText(nn, source);
        symbols.push({
          kind: "class",
          name,
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: isTsExported(child),
          parentClass: null,
        });
        const body = child.childForFieldName("body");
        if (body) tsClassBody(body, source, symbols, name);
        break;
      }
      case "interface_declaration": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "interface",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: isTsExported(child),
            parentClass: null,
          });
        break;
      }
      case "type_alias_declaration": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "type",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: isTsExported(child),
            parentClass: null,
          });
        break;
      }
      case "export_statement": {
        const decl = child.childForFieldName("declaration");
        if (decl) tsWalkExportDecl(decl, source, symbols);
        break;
      }
      case "lexical_declaration":
      case "variable_declaration": {
        for (let j = 0; j < child.namedChildCount; j++) {
          const decl = child.namedChild(j);
          if (decl && decl.type === "variable_declarator") {
            const nn = decl.childForFieldName("name");
            if (nn) {
              const val = decl.childForFieldName("value");
              const isFn =
                val && (val.type === "arrow_function" || val.type === "function_expression");
              symbols.push({
                kind: isFn ? "function" : "variable",
                name: nodeText(nn, source),
                range: nodeRange(decl),
                signature: isFn && val ? `const ${nodeText(nn, source)} = ${sig(val, source)}` : "",
                isExported: false,
                parentClass: null,
              });
            }
          }
        }
        break;
      }
    }
  }

  return { symbols, imports: [], exports: [], warnings };
};

function isTsExported(node: Node): boolean {
  const p = node.parent;
  return p !== null && p.type === "export_statement";
}

function tsWalkExportDecl(node: Node, source: string, symbols: Symbol[]): void {
  switch (node.type) {
    case "function_declaration": {
      const nn = node.childForFieldName("name");
      if (nn)
        symbols.push({
          kind: "function",
          name: nodeText(nn, source),
          range: nodeRange(node),
          signature: sig(node, source),
          isExported: true,
          parentClass: null,
        });
      break;
    }
    case "class_declaration": {
      const nn = node.childForFieldName("name");
      if (!nn) break;
      const name = nodeText(nn, source);
      symbols.push({
        kind: "class",
        name,
        range: nodeRange(node),
        signature: sig(node, source),
        isExported: true,
        parentClass: null,
      });
      const body = node.childForFieldName("body");
      if (body) tsClassBody(body, source, symbols, name);
      break;
    }
    case "lexical_declaration":
    case "variable_declaration": {
      for (let j = 0; j < node.namedChildCount; j++) {
        const decl = node.namedChild(j);
        if (decl && decl.type === "variable_declarator") {
          const nn = decl.childForFieldName("name");
          if (nn)
            symbols.push({
              kind: "variable",
              name: nodeText(nn, source),
              range: nodeRange(decl),
              signature: "",
              isExported: true,
              parentClass: null,
            });
        }
      }
      break;
    }
  }
}

function tsClassBody(body: Node, source: string, symbols: Symbol[], className: string): void {
  for (let i = 0; i < body.namedChildCount; i++) {
    const child = body.namedChild(i);
    if (child?.type !== "method_definition") continue;
    const nn = child.childForFieldName("name");
    if (!nn) continue;
    symbols.push({
      kind: "method",
      name: nodeText(nn, source),
      range: nodeRange(child),
      signature: sig(child, source),
      isExported: false,
      parentClass: className,
    });
  }
}

const tsCallees = (
  source: string,
  lang: Language,
  range: ByteRange,
): Array<{ name: string; line: number }> =>
  queryCaptures(source, lang, "(call_expression function: (identifier) @callee)", "callee", range);

// ── Python ───────────────────────────────────────────────────────────────

const pyExtract = (source: string, root: Node): ExtractedFile => {
  const symbols: Symbol[] = [];
  const warnings: string[] = [];
  if (root.hasError) warnings.push("tree-sitter reported syntax errors");

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i);
    if (!child) continue;

    switch (child.type) {
      case "function_definition": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        const name = nodeText(nn, source);
        symbols.push({
          kind: "function",
          name,
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: pyIsExported(name),
          parentClass: null,
        });
        break;
      }
      case "decorated_definition": {
        const fn = child.childForFieldName("definition");
        if (fn?.type !== "function_definition") break;
        const nn = fn.childForFieldName("name");
        if (!nn) break;
        const name = nodeText(nn, source);
        symbols.push({
          kind: "function",
          name,
          range: nodeRange(child),
          signature: sig(fn, source),
          isExported: pyIsExported(name),
          parentClass: null,
        });
        break;
      }
      case "class_definition": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        const name = nodeText(nn, source);
        symbols.push({
          kind: "class",
          name,
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: pyIsExported(name),
          parentClass: null,
        });
        const body = child.childForFieldName("body");
        if (body) pyClassBody(body, source, symbols, name);
        break;
      }
    }
  }

  return { symbols, imports: [], exports: [], warnings };
};

function pyIsExported(name: string): boolean {
  return (name.startsWith("__") && name.endsWith("__")) || !name.startsWith("_");
}

function pyClassBody(body: Node, source: string, symbols: Symbol[], className: string): void {
  for (let i = 0; i < body.namedChildCount; i++) {
    const child = body.namedChild(i);
    if (!child) continue;
    if (child.type === "function_definition") {
      const nn = child.childForFieldName("name");
      if (nn)
        symbols.push({
          kind: "method",
          name: nodeText(nn, source),
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: false,
          parentClass: className,
        });
    } else if (child.type === "decorated_definition") {
      const inner = child.childForFieldName("definition");
      if (inner && inner.type === "function_definition") {
        const nn = inner.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "method",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(inner, source),
            isExported: false,
            parentClass: className,
          });
      }
    }
  }
}

const pyCallees = (
  source: string,
  lang: Language,
  range: ByteRange,
): Array<{ name: string; line: number }> =>
  queryCaptures(
    source,
    lang,
    "(call function: (identifier) @callee)\n(call function: (attribute attribute: (identifier) @callee))",
    "callee",
    range,
  );

// ── Rust ─────────────────────────────────────────────────────────────────

const rsExtract = (source: string, root: Node): ExtractedFile => {
  const symbols: Symbol[] = [];
  const warnings: string[] = [];
  if (root.hasError) warnings.push("tree-sitter reported syntax errors");

  for (let i = 0; i < root.namedChildCount; i++) {
    const item = root.namedChild(i);
    if (!item) continue;

    switch (item.type) {
      case "function_item":
      case "function_signature_item": {
        const name = rsIdentChild(item, source);
        if (name)
          symbols.push({
            kind: "function",
            name,
            range: nodeRange(item),
            signature: sig(item, source),
            isExported: rsIsExported(item),
            parentClass: null,
          });
        break;
      }
      case "struct_item":
      case "enum_item":
      case "union_item": {
        const name = rsIdentChild(item, source);
        if (name)
          symbols.push({
            kind: "class",
            name,
            range: nodeRange(item),
            signature: nodeText(item, source).split("\n")[0] || "",
            isExported: rsIsExported(item),
            parentClass: null,
          });
        break;
      }
      case "trait_item": {
        const name = rsIdentChild(item, source);
        if (name)
          symbols.push({
            kind: "interface",
            name,
            range: nodeRange(item),
            signature: nodeText(item, source).split("\n")[0] || "",
            isExported: rsIsExported(item),
            parentClass: null,
          });
        break;
      }
      case "type_item": {
        const name = rsIdentChild(item, source);
        if (name)
          symbols.push({
            kind: "type",
            name,
            range: nodeRange(item),
            signature: sig(item, source),
            isExported: rsIsExported(item),
            parentClass: null,
          });
        break;
      }
      case "impl_item": {
        const type = item.childForFieldName("type");
        const target = type ? rsTypeLeafName(type, source) : null;
        if (target) {
          for (let j = 0; j < item.namedChildCount; j++) {
            const child = item.namedChild(j);
            if (child && child.type === "declaration_list")
              rsImplBody(child, source, symbols, target);
          }
        }
        break;
      }
      case "const_item":
      case "static_item": {
        const name = rsIdentChild(item, source);
        if (name)
          symbols.push({
            kind: "variable",
            name,
            range: nodeRange(item),
            signature: sig(item, source),
            isExported: rsIsExported(item),
            parentClass: null,
          });
        break;
      }
    }
  }

  return { symbols, imports: [], exports: [], warnings };
};

function rsIsExported(node: Node): boolean {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c && c.type === "visibility_modifier") return true;
  }
  return false;
}

function rsIdentChild(node: Node, source: string): string | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c && (c.type === "identifier" || c.type === "type_identifier")) return nodeText(c, source);
  }
  return null;
}

function rsTypeLeafName(node: Node, source: string): string | null {
  switch (node.type) {
    case "type_identifier":
      return nodeText(node, source);
    case "generic_type":
    case "scoped_type_identifier": {
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i);
        if (c) {
          const name = rsTypeLeafName(c, source);
          if (name) return name;
        }
      }
      return null;
    }
    default:
      return null;
  }
}

function rsImplBody(body: Node, source: string, symbols: Symbol[], target: string): void {
  for (let i = 0; i < body.namedChildCount; i++) {
    const child = body.namedChild(i);
    if (child?.type !== "function_item") continue;
    const name = rsIdentChild(child, source);
    if (name)
      symbols.push({
        kind: "method",
        name,
        range: nodeRange(child),
        signature: sig(child, source),
        isExported: rsIsExported(child),
        parentClass: target,
      });
  }
}

const rsCallees = (
  source: string,
  lang: Language,
  range: ByteRange,
): Array<{ name: string; line: number }> =>
  queryCaptures(
    source,
    lang,
    [
      "(call_expression function: (identifier) @callee)",
      "(call_expression function: (field_expression field: (field_identifier) @callee))",
      "(macro_invocation macro: (identifier) @callee)",
    ].join("\n"),
    "callee",
    range,
  );

// ── Clojure ──────────────────────────────────────────────────────────────

const cljExtract = (source: string, root: Node): ExtractedFile => {
  const symbols: Symbol[] = [];
  const warnings: string[] = [];
  if (root.hasError) warnings.push("tree-sitter reported syntax errors");

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i);
    if (child?.type !== "list_lit") continue;

    const first = child.namedChild(0);
    if (first?.type !== "sym_lit") continue;

    const head = nodeText(first, source);
    const nameNode = child.namedChild(1);
    if (!nameNode) continue;
    const name = nodeText(nameNode, source);

    if (head === "defn" || head === "defn-") {
      symbols.push({
        kind: "function",
        name,
        range: nodeRange(child),
        signature: source.slice(child.startIndex, child.endIndex).split("\n")[0] || "",
        isExported: !head.endsWith("-"),
        parentClass: null,
      });
    } else if (head === "def" || head === "defonce") {
      symbols.push({
        kind: "variable",
        name,
        range: nodeRange(child),
        signature: source.slice(child.startIndex, child.endIndex).split("\n")[0] || "",
        isExported: true,
        parentClass: null,
      });
    } else if (head === "defprotocol") {
      symbols.push({
        kind: "interface",
        name,
        range: nodeRange(child),
        signature: source.slice(child.startIndex, child.endIndex).split("\n")[0] || "",
        isExported: true,
        parentClass: null,
      });
      // Walk protocol methods
      for (let j = 2; j < child.namedChildCount; j++) {
        const m = child.namedChild(j);
        if (m && m.type === "list_lit") {
          const mn = m.namedChild(0);
          if (mn && mn.type === "sym_lit") {
            symbols.push({
              kind: "method",
              name: nodeText(mn, source),
              range: nodeRange(m),
              signature: "",
              isExported: true,
              parentClass: name,
            });
          }
        }
      }
    } else if (head === "defrecord" || head === "deftype") {
      symbols.push({
        kind: "class",
        name,
        range: nodeRange(child),
        signature: source.slice(child.startIndex, child.endIndex).split("\n")[0] || "",
        isExported: true,
        parentClass: null,
      });
    } else if (head === "defmethod") {
      // defmethod name dispatch-val ... — parent class is the multimethod name
      const dispatchNode = child.namedChild(2);
      const parentClass = dispatchNode ? nodeText(dispatchNode, source) : null;
      symbols.push({
        kind: "method",
        name,
        range: nodeRange(child),
        signature: source.slice(child.startIndex, child.endIndex).split("\n")[0] || "",
        isExported: true,
        parentClass,
      });
    }
  }

  return { symbols, imports: [], exports: [], warnings };
};

const cljCallees = (
  source: string,
  lang: Language,
  range: ByteRange,
): Array<{ name: string; line: number }> =>
  queryCaptures(source, lang, "(list_lit (sym_lit) @callee)", "callee", range);

// ── Go ───────────────────────────────────────────────────────────────────

const goExtract = (source: string, root: Node): ExtractedFile => {
  const symbols: Symbol[] = [];
  const warnings: string[] = [];
  if (root.hasError) warnings.push("tree-sitter reported syntax errors");

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i);
    if (!child) continue;

    switch (child.type) {
      case "function_declaration": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        const name = nodeText(nn, source);
        symbols.push({
          kind: "function",
          name,
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: goIsExported(name),
          parentClass: null,
        });
        break;
      }
      case "method_declaration": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        const name = nodeText(nn, source);
        const receiver = child.childForFieldName("receiver");
        let parentClass: string | null = null;
        if (receiver) {
          for (let j = 0; j < receiver.namedChildCount; j++) {
            const rc = receiver.namedChild(j);
            if (rc && rc.type === "type_identifier") {
              parentClass = nodeText(rc, source);
              break;
            }
          }
        }
        symbols.push({
          kind: "method",
          name,
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: goIsExported(name),
          parentClass,
        });
        break;
      }
      case "type_spec": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        const name = nodeText(nn, source);
        const tn = child.childForFieldName("type");
        if (!tn) break;
        const firstLine = source.slice(child.startIndex, child.endIndex).split("\n")[0] || "";
        if (tn.type === "struct_type") {
          symbols.push({
            kind: "class",
            name,
            range: nodeRange(child),
            signature: firstLine,
            isExported: goIsExported(name),
            parentClass: null,
          });
        } else if (tn.type === "interface_type") {
          symbols.push({
            kind: "interface",
            name,
            range: nodeRange(child),
            signature: firstLine,
            isExported: goIsExported(name),
            parentClass: null,
          });
        } else {
          symbols.push({
            kind: "type",
            name,
            range: nodeRange(child),
            signature: firstLine,
            isExported: goIsExported(name),
            parentClass: null,
          });
        }
        break;
      }
      case "var_declaration":
      case "const_declaration":
        goWalkSpecs(child, source, symbols);
        break;
    }
  }

  return { symbols, imports: [], exports: [], warnings };
};

/** Walk var_spec / const_spec children inside a var_declaration or const_declaration. */
function goWalkSpecs(node: Node, source: string, symbols: Symbol[]): void {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;
    if (child.type === "var_spec_list" || child.type === "const_spec_list") {
      goWalkSpecs(child, source, symbols);
    } else if (child.type === "var_spec" || child.type === "const_spec") {
      const nn = child.childForFieldName("name");
      if (nn)
        symbols.push({
          kind: "variable",
          name: nodeText(nn, source),
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: goIsExported(nodeText(nn, source)),
          parentClass: null,
        });
    }
  }
}

function goIsExported(name: string): boolean {
  const firstCharacter = name.at(0);
  return firstCharacter !== undefined && firstCharacter === firstCharacter.toUpperCase();
}

const goCallees = (
  source: string,
  lang: Language,
  range: ByteRange,
): Array<{ name: string; line: number }> =>
  queryCaptures(
    source,
    lang,
    [
      "(call_expression function: (identifier) @callee)",
      "(call_expression function: (selector_expression field: (field_identifier) @callee))",
    ].join("\n"),
    "callee",
    range,
  );

// ── Kotlin ───────────────────────────────────────────────────────────────

/** Walk a class_body / enum_class_body, extracting member symbols. */
function ktWalkClassBody(body: Node, source: string, symbols: Symbol[], parentClass: string): void {
  for (let i = 0; i < body.namedChildCount; i++) {
    const child = body.namedChild(i);
    if (!child) continue;
    switch (child.type) {
      case "function_declaration": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "method",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass,
          });
        break;
      }
      case "property_declaration": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "variable",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass,
          });
        break;
      }
      case "companion_object": {
        const nn = child.childForFieldName("name");
        const compName = nn ? nodeText(nn, source) : "Companion";
        symbols.push({
          kind: "class",
          name: compName,
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: true,
          parentClass,
        });
        ktWalkClassBodies(child, source, symbols, compName);
        break;
      }
      case "class_declaration": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        const name = nodeText(nn, source);
        symbols.push({
          kind: "class",
          name,
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: true,
          parentClass,
        });
        ktWalkClassBodies(child, source, symbols, name);
        break;
      }
      case "object_declaration": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        const name = nodeText(nn, source);
        symbols.push({
          kind: "class",
          name,
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: true,
          parentClass,
        });
        ktWalkClassBodies(child, source, symbols, name);
        break;
      }
      case "type_alias": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "type",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass,
          });
        break;
      }
    }
  }
}

/** Find class_body and enum_class_body children of a node and walk them. */
function ktWalkClassBodies(
  node: Node,
  source: string,
  symbols: Symbol[],
  parentClass: string,
): void {
  for (let i = 0; i < node.namedChildCount; i++) {
    const body = node.namedChild(i);
    if (body && (body.type === "class_body" || body.type === "enum_class_body")) {
      ktWalkClassBody(body, source, symbols, parentClass);
    }
  }
}

/** Check if a class_declaration node is actually an interface by examining the keyword token. */
function ktIsInterface(node: Node, source: string): boolean {
  // The first keyword after optional modifiers distinguishes class vs interface.
  // Scan children for unnamed tokens that are "interface", "class", or "enum".
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (!c || c.isNamed) continue;
    const token = source.slice(c.startIndex, c.endIndex);
    if (token === "interface") return true;
    if (token === "class" || token === "enum") return false;
  }
  return false;
}

const ktExtract = (source: string, root: Node): ExtractedFile => {
  const symbols: Symbol[] = [];
  const warnings: string[] = [];
  if (root.hasError) warnings.push("tree-sitter reported syntax errors");

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i);
    if (!child) continue;

    switch (child.type) {
      case "function_declaration": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "function",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
      case "class_declaration": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        const name = nodeText(nn, source);
        const kind: SymbolKind = ktIsInterface(child, source) ? "interface" : "class";
        symbols.push({
          kind,
          name,
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: true,
          parentClass: null,
        });
        ktWalkClassBodies(child, source, symbols, name);
        break;
      }
      case "object_declaration": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        const name = nodeText(nn, source);
        symbols.push({
          kind: "class",
          name,
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: true,
          parentClass: null,
        });
        ktWalkClassBodies(child, source, symbols, name);
        break;
      }
      case "property_declaration": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "variable",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
      case "type_alias": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "type",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
    }
  }

  return { symbols, imports: [], exports: [], warnings };
};

const ktCallees = (
  source: string,
  lang: Language,
  range: ByteRange,
): Array<{ name: string; line: number }> => {
  const simple = queryCaptures(
    source,
    lang,
    "(call_expression (expression (primary_expression (identifier) @callee)))",
    "callee",
    range,
  );
  const member = queryCaptures(
    source,
    lang,
    "(call_expression (navigation_expression (navigation_suffix (simple_identifier) @callee)))",
    "callee",
    range,
  );
  return [...simple, ...member];
};

// ── Lua ──────────────────────────────────────────────────────────────────

const luaExtract = (source: string, root: Node): ExtractedFile => {
  const symbols: Symbol[] = [];
  const warnings: string[] = [];
  if (root.hasError) warnings.push("tree-sitter reported syntax errors");

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i);
    if (!child) continue;

    if (child.type !== "function_declaration") continue;
    const name = child.childForFieldName("name");
    if (!name) continue;
    symbols.push({
      kind: "function",
      name: nodeText(name, source),
      range: nodeRange(child),
      signature: sig(child, source),
      isExported: child.child(0)?.type !== "local",
      parentClass: null,
    });
  }

  return { symbols, imports: [], exports: [], warnings };
};

const luaCallees = (
  source: string,
  lang: Language,
  range: ByteRange,
): Array<{ name: string; line: number }> =>
  queryCaptures(
    source,
    lang,
    "(function_call name: [(identifier) (dot_index_expression) (method_index_expression)] @callee)",
    "callee",
    range,
  );

// ── PHP ──────────────────────────────────────────────────────────────────

const phpExtract = (source: string, root: Node): ExtractedFile => {
  const symbols: Symbol[] = [];
  const warnings: string[] = [];
  if (root.hasError) warnings.push("tree-sitter reported syntax errors");

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i);
    if (!child) continue;

    switch (child.type) {
      case "function_definition": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "function",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
      case "class_declaration": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        const name = nodeText(nn, source);
        symbols.push({
          kind: "class",
          name,
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: true,
          parentClass: null,
        });
        // Walk class body for methods
        const body = child.childForFieldName("body");
        if (body) {
          for (let j = 0; j < body.namedChildCount; j++) {
            const m = body.namedChild(j);
            if (m && m.type === "method_declaration") {
              const mn = m.childForFieldName("name");
              if (mn)
                symbols.push({
                  kind: "method",
                  name: nodeText(mn, source),
                  range: nodeRange(m),
                  signature: sig(m, source),
                  isExported: false,
                  parentClass: name,
                });
            }
          }
        }
        break;
      }
      case "interface_declaration": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "interface",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
      case "trait_declaration": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "interface",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
    }
  }

  return { symbols, imports: [], exports: [], warnings };
};

const phpCallees = (
  source: string,
  lang: Language,
  range: ByteRange,
): Array<{ name: string; line: number }> =>
  queryCaptures(
    source,
    lang,
    "(function_call_expression function: (name) @callee)",
    "callee",
    range,
  );

// ── Scala ────────────────────────────────────────────────────────────────

const scalaExtract = (source: string, root: Node): ExtractedFile => {
  const symbols: Symbol[] = [];
  const warnings: string[] = [];
  if (root.hasError) warnings.push("tree-sitter reported syntax errors");

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i);
    if (!child) continue;

    switch (child.type) {
      case "function_definition": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "function",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
      case "class_definition": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        const name = nodeText(nn, source);
        symbols.push({
          kind: "class",
          name,
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: true,
          parentClass: null,
        });
        break;
      }
      case "trait_definition": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "interface",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
      case "object_definition": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "class",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
    }
  }

  return { symbols, imports: [], exports: [], warnings };
};

const scalaCallees = (
  source: string,
  lang: Language,
  range: ByteRange,
): Array<{ name: string; line: number }> =>
  queryCaptures(source, lang, "(call_expression function: (identifier) @callee)", "callee", range);

// ── Swift ────────────────────────────────────────────────────────────────

const swiftExtract = (source: string, root: Node): ExtractedFile => {
  const symbols: Symbol[] = [];
  const warnings: string[] = [];
  if (root.hasError) warnings.push("tree-sitter reported syntax errors");

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i);
    if (!child) continue;

    switch (child.type) {
      case "function_declaration": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "function",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
      case "class_declaration": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        const name = nodeText(nn, source);
        symbols.push({
          kind: "class",
          name,
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: true,
          parentClass: null,
        });
        break;
      }
      case "struct_declaration": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        const name = nodeText(nn, source);
        symbols.push({
          kind: "class",
          name,
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: true,
          parentClass: null,
        });
        break;
      }
      case "protocol_declaration": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "interface",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
      case "enum_declaration": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        const name = nodeText(nn, source);
        symbols.push({
          kind: "class",
          name,
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: true,
          parentClass: null,
        });
        break;
      }
    }
  }

  return { symbols, imports: [], exports: [], warnings };
};

const swiftCallees = (
  source: string,
  lang: Language,
  range: ByteRange,
): Array<{ name: string; line: number }> =>
  queryCaptures(source, lang, "(call_expression (simple_identifier) @callee)", "callee", range);

// ── Java ─────────────────────────────────────────────────────────────────

/** Walk a Java class_body, extracting member declarations. */
function javaWalkClassBody(
  body: Node,
  source: string,
  symbols: Symbol[],
  parentClass: string,
): void {
  for (let i = 0; i < body.namedChildCount; i++) {
    const child = body.namedChild(i);
    if (!child) continue;
    switch (child.type) {
      case "method_declaration": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "method",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass,
          });
        break;
      }
      case "constructor_declaration": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "method",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass,
          });
        break;
      }
      case "field_declaration": {
        for (let j = 0; j < child.namedChildCount; j++) {
          const decl = child.namedChild(j);
          if (decl && decl.type === "variable_declarator") {
            const nn = decl.childForFieldName("name");
            if (nn)
              symbols.push({
                kind: "variable",
                name: nodeText(nn, source),
                range: nodeRange(decl),
                signature: sig(child, source),
                isExported: true,
                parentClass,
              });
          }
        }
        break;
      }
      case "class_declaration": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        const name = nodeText(nn, source);
        symbols.push({
          kind: "class",
          name,
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: true,
          parentClass,
        });
        const cb = child.childForFieldName("body");
        if (cb) javaWalkClassBody(cb, source, symbols, name);
        break;
      }
      case "interface_declaration": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "interface",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass,
          });
        break;
      }
      case "enum_declaration": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        const name = nodeText(nn, source);
        symbols.push({
          kind: "class",
          name,
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: true,
          parentClass,
        });
        const cb = child.childForFieldName("body");
        if (cb) javaWalkClassBody(cb, source, symbols, name);
        break;
      }
      case "record_declaration": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        const name = nodeText(nn, source);
        symbols.push({
          kind: "class",
          name,
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: true,
          parentClass,
        });
        const cb = child.childForFieldName("body");
        if (cb) javaWalkClassBody(cb, source, symbols, name);
        break;
      }
    }
  }
}

const javaExtract = (source: string, root: Node): ExtractedFile => {
  const symbols: Symbol[] = [];
  const warnings: string[] = [];
  if (root.hasError) warnings.push("tree-sitter reported syntax errors");

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i);
    if (!child) continue;
    switch (child.type) {
      case "class_declaration": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        const name = nodeText(nn, source);
        symbols.push({
          kind: "class",
          name,
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: true,
          parentClass: null,
        });
        const body = child.childForFieldName("body");
        if (body) javaWalkClassBody(body, source, symbols, name);
        break;
      }
      case "interface_declaration": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "interface",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
      case "enum_declaration": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        const name = nodeText(nn, source);
        symbols.push({
          kind: "class",
          name,
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: true,
          parentClass: null,
        });
        const body = child.childForFieldName("body");
        if (body) javaWalkClassBody(body, source, symbols, name);
        break;
      }
      case "record_declaration": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        const name = nodeText(nn, source);
        symbols.push({
          kind: "class",
          name,
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: true,
          parentClass: null,
        });
        const body = child.childForFieldName("body");
        if (body) javaWalkClassBody(body, source, symbols, name);
        break;
      }
      case "annotation_type_declaration": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "interface",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
    }
  }
  return { symbols, imports: [], exports: [], warnings };
};

const javaCallees = (
  source: string,
  lang: Language,
  range: ByteRange,
): Array<{ name: string; line: number }> =>
  queryCaptures(source, lang, "(method_invocation name: (identifier) @callee)", "callee", range);

// ── Ruby ─────────────────────────────────────────────────────────────────

const rbExtract = (source: string, root: Node): ExtractedFile => {
  const symbols: Symbol[] = [];
  const warnings: string[] = [];
  if (root.hasError) warnings.push("tree-sitter reported syntax errors");

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i);
    if (!child) continue;
    switch (child.type) {
      case "method": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "function",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
      case "class": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        const name = nodeText(nn, source);
        symbols.push({
          kind: "class",
          name,
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: true,
          parentClass: null,
        });
        break;
      }
      case "module": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        symbols.push({
          kind: "class",
          name: nodeText(nn, source),
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: true,
          parentClass: null,
        });
        break;
      }
      case "singleton_method": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "method",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
    }
  }
  return { symbols, imports: [], exports: [], warnings };
};

const rbCallees = (
  source: string,
  lang: Language,
  range: ByteRange,
): Array<{ name: string; line: number }> =>
  queryCaptures(source, lang, "(call method: (identifier) @callee)", "callee", range);

// ── C ───────────────────────────────────────────────────────────────────-

function cFuncName(node: Node, source: string): string | null {
  const decl = node.childForFieldName("declarator");
  if (!decl) return null;
  // declarator may be function_declarator → declarator → identifier
  // or just identifier for simple cases
  let cursor: Node | null = decl;
  for (let i = 0; i < 5; i++) {
    if (!cursor) return null;
    const nn = cursor.childForFieldName("name");
    if (nn) return nodeText(nn, source);
    // descend through function_declarator → declarator
    const inner = cursor.childForFieldName("declarator");
    if (inner) {
      cursor = inner;
      continue;
    }
    // or direct identifier child
    for (let j = 0; j < cursor.namedChildCount; j++) {
      const c = cursor.namedChild(j);
      if (c && c.type === "identifier") return nodeText(c, source);
    }
    break;
  }
  return null;
}

const cExtract = (source: string, root: Node): ExtractedFile => {
  const symbols: Symbol[] = [];
  const warnings: string[] = [];
  if (root.hasError) warnings.push("tree-sitter reported syntax errors");

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i);
    if (!child) continue;
    switch (child.type) {
      case "function_definition": {
        const name = cFuncName(child, source);
        if (name)
          symbols.push({
            kind: "function",
            name,
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
      case "struct_specifier":
      case "union_specifier": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "class",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
      case "enum_specifier": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "class",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
    }
  }
  return { symbols, imports: [], exports: [], warnings };
};

const cCallees = (
  source: string,
  lang: Language,
  range: ByteRange,
): Array<{ name: string; line: number }> =>
  queryCaptures(source, lang, "(call_expression function: (identifier) @callee)", "callee", range);

// ── C++ ──────────────────────────────────────────────────────────────────

const cppExtract = (source: string, root: Node): ExtractedFile => {
  const symbols: Symbol[] = [];
  const warnings: string[] = [];
  if (root.hasError) warnings.push("tree-sitter reported syntax errors");

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i);
    if (!child) continue;
    switch (child.type) {
      case "function_definition": {
        const name = cFuncName(child, source);
        if (name)
          symbols.push({
            kind: "function",
            name,
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
      case "class_specifier":
      case "struct_specifier":
      case "union_specifier": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "class",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
      case "enum_specifier": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "class",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
      case "namespace_definition": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "interface",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
    }
  }
  return { symbols, imports: [], exports: [], warnings };
};

const cppCallees = (
  source: string,
  lang: Language,
  range: ByteRange,
): Array<{ name: string; line: number }> =>
  queryCaptures(source, lang, "(call_expression function: (identifier) @callee)", "callee", range);

// ── Zig ──────────────────────────────────────────────────────────────────

const zigExtract = (source: string, root: Node): ExtractedFile => {
  const symbols: Symbol[] = [];
  const warnings: string[] = [];
  if (root.hasError) warnings.push("tree-sitter reported syntax errors");

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i);
    if (!child) continue;

    const t = child.type;
    if (t === "function_declaration" || t === "fn_prototype") {
      const nn = child.childForFieldName("name");
      if (nn)
        symbols.push({
          kind: "function",
          name: nodeText(nn, source),
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: true,
          parentClass: null,
        });
    } else if (t === "variable_declaration") {
      const nn = child.childForFieldName("name");
      if (nn)
        symbols.push({
          kind: "variable",
          name: nodeText(nn, source),
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: true,
          parentClass: null,
        });
    } else if (t === "container_declaration") {
      const nn = child.childForFieldName("name");
      if (nn)
        symbols.push({
          kind: "class",
          name: nodeText(nn, source),
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: true,
          parentClass: null,
        });
    }
  }
  return { symbols, imports: [], exports: [], warnings };
};

const zigCallees = (
  source: string,
  lang: Language,
  range: ByteRange,
): Array<{ name: string; line: number }> =>
  queryCaptures(source, lang, "(call_expression function: (identifier) @callee)", "callee", range);

// ── Elixir ───────────────────────────────────────────────────────────────

const ELIXIR_DEF_KWS = new Set(["def", "defp", "defmacro", "defmacrop", "defguard", "defguardp"]);
const ELIXIR_MOD_KWS = new Set(["defmodule", "defprotocol", "defimpl"]);

function elixirKw(call: Node, source: string): string | null {
  const target = call.childForFieldName("target");
  if (target?.type !== "identifier") return null;
  return nodeText(target, source);
}

function elixirFuncName(call: Node, source: string): string | null {
  const args = call.childForFieldName("arguments");
  if (!args) return null;
  const first = args.namedChild(0);
  if (!first) return null;
  // Function name might be an identifier or a call (for `def foo.bar`)
  if (first.type === "identifier" || first.type === "call") {
    return nodeText(first, source);
  }
  return null;
}

function elixirModName(call: Node, source: string): string | null {
  const args = call.childForFieldName("arguments");
  if (!args) return null;
  const first = args.namedChild(0);
  if (!first) return null;
  // Module name can be alias, identifier, or dot call
  if (first.type === "alias" || first.type === "identifier") {
    return nodeText(first, source);
  }
  // Handle Elixir's `alias` node type
  for (let i = 0; i < first.namedChildCount; i++) {
    const c = first.namedChild(i);
    if (c && (c.type === "alias" || c.type === "identifier")) {
      return nodeText(c, source);
    }
  }
  return null;
}

function elixirDoBlock(call: Node): Node | null {
  for (let i = 0; i < call.namedChildCount; i++) {
    const c = call.namedChild(i);
    if (c && c.type === "do_block") return c;
  }
  return null;
}

function elixirWalkBlock(
  block: Node,
  source: string,
  symbols: Symbol[],
  parent: string | null,
): void {
  for (let i = 0; i < block.namedChildCount; i++) {
    const c = block.namedChild(i);
    if (c?.type !== "call") continue;
    const kw = elixirKw(c, source);
    if (!kw) continue;

    if (ELIXIR_MOD_KWS.has(kw)) {
      const name = elixirModName(c, source);
      if (name) {
        const kind = kw === "defprotocol" ? ("interface" as const) : ("class" as const);
        symbols.push({
          kind,
          name,
          range: nodeRange(c),
          signature: sig(c, source),
          isExported: true,
          parentClass: parent,
        });
        const db = elixirDoBlock(c);
        if (db) elixirWalkBlock(db, source, symbols, name);
      }
    } else if (ELIXIR_DEF_KWS.has(kw)) {
      const name = elixirFuncName(c, source);
      if (name) {
        symbols.push({
          kind: "function",
          name,
          range: nodeRange(c),
          signature: sig(c, source),
          isExported: kw !== "defp" && kw !== "defmacrop" && kw !== "defguardp",
          parentClass: parent,
        });
      }
    }
  }
}

const elixirExtract = (source: string, root: Node): ExtractedFile => {
  const symbols: Symbol[] = [];
  const warnings: string[] = [];
  if (root.hasError) warnings.push("tree-sitter reported syntax errors");
  elixirWalkBlock(root, source, symbols, null);
  return { symbols, imports: [], exports: [], warnings };
};

const elixirCallees = (
  source: string,
  lang: Language,
  range: ByteRange,
): Array<{ name: string; line: number }> =>
  queryCaptures(source, lang, "(call target: (identifier) @callee)", "callee", range);

// ── C# ───────────────────────────────────────────────────────────────────

const csExtract = (source: string, root: Node): ExtractedFile => {
  const symbols: Symbol[] = [];
  const warnings: string[] = [];
  if (root.hasError) warnings.push("tree-sitter reported syntax errors");

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i);
    if (!child) continue;

    switch (child.type) {
      case "class_declaration":
      case "struct_declaration": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        const name = nodeText(nn, source);
        symbols.push({
          kind: "class",
          name,
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: true,
          parentClass: null,
        });
        // Walk class body for methods
        const body = child.childForFieldName("body");
        if (body) {
          for (let j = 0; j < body.namedChildCount; j++) {
            const m = body.namedChild(j);
            if (m && m.type === "method_declaration") {
              const mn = m.childForFieldName("name");
              if (mn)
                symbols.push({
                  kind: "method",
                  name: nodeText(mn, source),
                  range: nodeRange(m),
                  signature: sig(m, source),
                  isExported: false,
                  parentClass: name,
                });
            }
          }
        }
        break;
      }
      case "interface_declaration": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "interface",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
      case "enum_declaration": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        symbols.push({
          kind: "class",
          name: nodeText(nn, source),
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: true,
          parentClass: null,
        });
        break;
      }
      case "namespace_declaration": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "interface",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
    }
  }
  return { symbols, imports: [], exports: [], warnings };
};

const csCallees = (
  source: string,
  lang: Language,
  range: ByteRange,
): Array<{ name: string; line: number }> =>
  queryCaptures(
    source,
    lang,
    "(invocation_expression function: (identifier) @callee)",
    "callee",
    range,
  );

// ── Dart ─────────────────────────────────────────────────────────────────

const dartExtract = (source: string, root: Node): ExtractedFile => {
  const symbols: Symbol[] = [];
  const warnings: string[] = [];
  if (root.hasError) warnings.push("tree-sitter reported syntax errors");

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i);
    if (!child) continue;

    switch (child.type) {
      case "class_declaration": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        const name = nodeText(nn, source);
        symbols.push({
          kind: "class",
          name,
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: true,
          parentClass: null,
        });
        const body = child.childForFieldName("body");
        if (body) {
          for (let j = 0; j < body.namedChildCount; j++) {
            const m = body.namedChild(j);
            if (m && (m.type === "method_declaration" || m.type === "constructor_declaration")) {
              const mn = m.childForFieldName("name");
              if (mn)
                symbols.push({
                  kind: "method",
                  name: nodeText(mn, source),
                  range: nodeRange(m),
                  signature: sig(m, source),
                  isExported: false,
                  parentClass: name,
                });
            }
          }
        }
        break;
      }
      case "function_declaration": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "function",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
      case "mixin_declaration": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "interface",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
      case "enum_declaration": {
        const nn = child.childForFieldName("name");
        if (!nn) break;
        symbols.push({
          kind: "class",
          name: nodeText(nn, source),
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: true,
          parentClass: null,
        });
        break;
      }
      case "top_level_variable_declaration": {
        const nn = child.childForFieldName("name");
        if (nn)
          symbols.push({
            kind: "variable",
            name: nodeText(nn, source),
            range: nodeRange(child),
            signature: sig(child, source),
            isExported: true,
            parentClass: null,
          });
        break;
      }
    }
  }
  return { symbols, imports: [], exports: [], warnings };
};

const dartCallees = (
  source: string,
  lang: Language,
  range: ByteRange,
): Array<{ name: string; line: number }> =>
  queryCaptures(source, lang, "(function_call function: (identifier) @callee)", "callee", range);

// ── Bash ─────────────────────────────────────────────────────────────────

const bashExtract = (source: string, root: Node): ExtractedFile => {
  const symbols: Symbol[] = [];
  const warnings: string[] = [];
  if (root.hasError) warnings.push("tree-sitter reported syntax errors");

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i);
    if (!child) continue;
    if (child.type === "function_definition") {
      const nn = child.childForFieldName("name");
      if (nn)
        symbols.push({
          kind: "function",
          name: nodeText(nn, source),
          range: nodeRange(child),
          signature: sig(child, source),
          isExported: true,
          parentClass: null,
        });
    }
  }
  return { symbols, imports: [], exports: [], warnings };
};

const bashCallees = (
  source: string,
  lang: Language,
  range: ByteRange,
): Array<{ name: string; line: number }> =>
  queryCaptures(source, lang, "(command name: (command_name) @callee)", "callee", range);

// ── Registry ─────────────────────────────────────────────────────────────

const LANGUAGES: LangConfig[] = [
  // Tools load each group's first extension, so shared extractors still need grammar-specific groups.
  {
    extensions: [".ts", ".mts", ".cts"],
    extract: extractWithTree(tsExtract),
    findCallees: tsCallees,
  },
  {
    extensions: [".tsx"],
    extract: extractWithTree(tsExtract),
    findCallees: tsCallees,
  },
  {
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    extract: extractWithTree(tsExtract),
    findCallees: tsCallees,
  },
  { extensions: [".py", ".pyi"], extract: extractWithTree(pyExtract), findCallees: pyCallees },
  { extensions: [".rs"], extract: extractWithTree(rsExtract), findCallees: rsCallees },
  { extensions: [".go"], extract: extractWithTree(goExtract), findCallees: goCallees },
  {
    extensions: [".clj", ".cljs", ".cljc", ".bb", ".edn", ".cljd"],
    extract: extractWithTree(cljExtract),
    findCallees: cljCallees,
  },
  { extensions: [".kt", ".kts"], extract: extractWithTree(ktExtract), findCallees: ktCallees },
  { extensions: [".lua"], extract: extractWithTree(luaExtract), findCallees: luaCallees },
  { extensions: [".php"], extract: extractWithTree(phpExtract), findCallees: phpCallees },
  { extensions: [".scala"], extract: extractWithTree(scalaExtract), findCallees: scalaCallees },
  { extensions: [".swift"], extract: extractWithTree(swiftExtract), findCallees: swiftCallees },
  { extensions: [".java"], extract: extractWithTree(javaExtract), findCallees: javaCallees },
  { extensions: [".rb"], extract: extractWithTree(rbExtract), findCallees: rbCallees },
  { extensions: [".c", ".h"], extract: extractWithTree(cExtract), findCallees: cCallees },
  {
    extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx", ".h"],
    extract: extractWithTree(cppExtract),
    findCallees: cppCallees,
  },
  { extensions: [".sh", ".bash"], extract: extractWithTree(bashExtract), findCallees: bashCallees },
  { extensions: [".zig"], extract: extractWithTree(zigExtract), findCallees: zigCallees },
  {
    extensions: [".ex", ".exs"],
    extract: extractWithTree(elixirExtract),
    findCallees: elixirCallees,
  },
  { extensions: [".cs"], extract: extractWithTree(csExtract), findCallees: csCallees },
  { extensions: [".dart"], extract: extractWithTree(dartExtract), findCallees: dartCallees },
];

/** Find the config for a file extension (e.g. ".ts"). */
export function configForExt(ext: string): LangConfig | null {
  const key = ext.toLowerCase();
  for (const c of LANGUAGES) {
    if (c.extensions.some((e) => e.toLowerCase() === key)) return c;
  }
  return null;
}

/** Find the config for a file, with .h content sniffing for C vs C++. */
export function configForFile(filePath: string, source?: string): LangConfig | null {
  const ext = filePath.match(/\.[^.]+$/)?.[0]?.toLowerCase();
  if (!ext) return null;
  if (ext !== ".h") return configForExt(ext);

  const content = source ?? readFileSafe(filePath);
  if (!content) return configForExt(".c");

  // Sniff for C++-only tokens
  const cleaned = stripCComments(content);
  if (/\b(class|namespace)\b|::|template\s*</.test(cleaned)) {
    return configForExt(".cpp");
  }
  return configForExt(".c");
}

/** All recognized extensions (with leading dot). */
export function allExtensions(): string[] {
  return Array.from(new Set(LANGUAGES.flatMap((c) => c.extensions)));
}
