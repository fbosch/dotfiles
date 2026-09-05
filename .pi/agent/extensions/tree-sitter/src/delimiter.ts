/**
 * Delimiter-balance scanner — fallback for Lisp-like languages without
 * a tree-sitter WASM grammar (Clojure, Janet, Fennel, Scheme, Elisp).
 *
 * Counts `()`, `[]`, `{}` while skipping comments, strings, and
 * char literals so the result is accurate enough for actionable
 * LLM feedback ("add N matching `)`").
 */

// ── Lex rules ────────────────────────────────────────────────────────────

export interface LexRules {
  lineComment: string | null;
  blockComment: [string, string] | null;
  nestedBlock: boolean;
  backtickLongString: boolean;
  charLiteral: "?" | null;
}

const RULES_LISP: LexRules = {
  lineComment: ";",
  blockComment: null,
  nestedBlock: false,
  backtickLongString: false,
  charLiteral: null,
};
const RULES_JANET: LexRules = {
  lineComment: "#",
  blockComment: ["#|", "|#"],
  nestedBlock: false,
  backtickLongString: true,
  charLiteral: null,
};
const RULES_SCHEME: LexRules = {
  lineComment: ";",
  blockComment: ["#|", "|#"],
  nestedBlock: true,
  backtickLongString: false,
  charLiteral: null,
};

export const BALANCE_RULES: Record<string, LexRules> = {
  ".clj": RULES_LISP,
  ".cljs": RULES_LISP,
  ".cljc": RULES_LISP,
  ".cljd": RULES_LISP,
  ".edn": RULES_LISP,
  ".bb": RULES_LISP,
  ".fnl": RULES_LISP,
  ".janet": RULES_JANET,
  ".jdn": RULES_JANET,
  ".scm": RULES_SCHEME,
  ".ss": RULES_SCHEME,
  ".rkt": RULES_SCHEME,
  ".lisp": RULES_SCHEME,
  ".lsp": RULES_SCHEME,
  ".cl": RULES_SCHEME,
  ".el": {
    lineComment: ";",
    blockComment: null,
    nestedBlock: false,
    backtickLongString: false,
    charLiteral: "?",
  },
};

// ── Scanner ──────────────────────────────────────────────────────────────

/** Count delimiters skipping comments, strings, and char literals.
 *  Returns null on balance, or a human-readable error string. */
export function checkDelimiterBalance(
  path: string,
  content: string,
  rules: LexRules,
): string | null {
  const b = content;
  const n = b.length;
  let i = 0;
  const lineStarts: number[] = [0];
  for (let j = 0; j < n; j++) {
    if (b[j] === "\n") lineStarts.push(j + 1);
  }

  function lineFor(pos: number): number {
    let lo = 0,
      hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      const lineStart = lineStarts[mid];
      if (lineStart !== undefined && lineStart <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  const stack: Array<{ ch: string; line: number; col: number }> = [];

  while (i < n) {
    const c = b[i];
    const next = i + 1 < n ? b[i + 1] : null;

    // Line comment
    if (rules.lineComment && c === rules.lineComment[0]) {
      const eol = b.indexOf("\n", i);
      i = eol === -1 ? n : eol + 1;
      continue;
    }

    // Block comment
    if (rules.blockComment) {
      const [open, close] = rules.blockComment;
      if (c === open[0] && next === open[1]) {
        i += 2;
        let depth = 1;
        while (i < n && depth > 0) {
          const cc = b[i];
          const nn = i + 1 < n ? b[i + 1] : null;
          if (rules.nestedBlock && cc === open[0] && nn === open[1]) {
            depth++;
            i += 2;
          } else if (cc === close[0] && nn === close[1]) {
            depth--;
            i += 2;
          } else {
            i++;
          }
        }
        continue;
      }
    }

    // String
    if (c === '"') {
      i++;
      while (i < n) {
        if (b[i] === "\\") {
          i += 2;
          continue;
        }
        if (b[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // Backtick long-string (Janet)
    if (rules.backtickLongString && c === "`") {
      let k = 0;
      while (i + k < n && b[i + k] === "`") k++;
      i += k;
      while (i < n) {
        if (b[i] === "`") {
          let j = 0;
          while (i + j < n && b[i + j] === "`") j++;
          if (j >= k) {
            i += k;
            break;
          }
          i += j;
        } else {
          i++;
        }
      }
      continue;
    }

    // Escape
    if (c === "\\" && i + 1 < n) {
      i += 2;
      continue;
    }

    // Char literal (Elisp: ?x, ?\()
    if (rules.charLiteral === "?" && c === "?" && i + 1 < n) {
      if (b[i + 1] === "\\" && i + 2 < n) i += 3;
      else i += 2;
      continue;
    }

    switch (c) {
      case "(": {
        const ln = lineFor(i);
        stack.push({ ch: "(", line: ln, col: i - (lineStarts[ln - 1] ?? 0) + 1 });
        break;
      }
      case ")": {
        const top = stack.pop();
        if (!top) return `${path}: stray \`)\` at line ${lineFor(i)} — no matching \`(\` before it`;
        if (top.ch !== "(")
          return `${path}: \`)\` at line ${lineFor(i)} doesn't close \`${top.ch}\` at line ${top.line} — expected \`${top.ch === "[" ? "]" : "}"}\``;
        break;
      }
      case "[": {
        const ln = lineFor(i);
        stack.push({ ch: "[", line: ln, col: i - (lineStarts[ln - 1] ?? 0) + 1 });
        break;
      }
      case "]": {
        const top = stack.pop();
        if (!top) return `${path}: stray \`]\` at line ${lineFor(i)} — no matching \`[\` before it`;
        if (top.ch !== "[")
          return `${path}: \`]\` at line ${lineFor(i)} doesn't close \`${top.ch}\` at line ${top.line} — expected \`${top.ch === "(" ? ")" : "}"}\``;
        break;
      }
      case "{": {
        const ln = lineFor(i);
        stack.push({ ch: "{", line: ln, col: i - (lineStarts[ln - 1] ?? 0) + 1 });
        break;
      }
      case "}": {
        const top = stack.pop();
        if (!top) return `${path}: stray \`}\` at line ${lineFor(i)} — no matching \`{\` before it`;
        if (top.ch !== "{")
          return `${path}: \`}\` at line ${lineFor(i)} doesn't close \`${top.ch}\` at line ${top.line} — expected \`${top.ch === "(" ? ")" : "]"}\``;
        break;
      }
    }

    i++;
  }

  const firstUnclosed = stack[0];
  if (firstUnclosed !== undefined) {
    const closer = firstUnclosed.ch === "(" ? ")" : firstUnclosed.ch === "[" ? "]" : "}";
    return `${path}: ${stack.length} unclosed \`${firstUnclosed.ch}\` — the one at line ${firstUnclosed.line} is never closed; add ${stack.length} matching \`${closer}\``;
  }

  return null;
}
