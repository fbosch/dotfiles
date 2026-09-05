import { type Language, Parser, type Tree } from "web-tree-sitter";

/** The callback must return detached data, not nodes backed by the released WASM tree. */
export function withParseTree<T>(
  source: string,
  language: Language,
  consume: (tree: Tree) => T,
): T {
  const parser = new Parser();
  let tree: Tree | null = null;
  try {
    parser.setLanguage(language);
    tree = parser.parse(source);
    if (tree === null) throw new Error("Tree-sitter returned no parse tree");
    return consume(tree);
  } finally {
    try {
      tree?.delete();
    } finally {
      parser.delete();
    }
  }
}
